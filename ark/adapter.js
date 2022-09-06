'use strict';

const { Connection } = require('@arkecosystem/client');
const { Identities } = require('@arkecosystem/crypto');

const { toBuffer } = require('../common/utils');
const {
  InvalidActionError,
  multisigAccountDidNotExistError,
  blockDidNotExistError,
  accountWasNotMultisigError,
  accountDidNotExistError,
  transactionBroadcastError,
} = require('./errors');

const { blockMapper, transactionMapper } = require('./mapper');
const packageJSON = require('../package.json');

const DEFAULT_MODULE_ALIAS = 'ark_dex_adapter';

const MODULE_BOOTSTRAP_EVENT = 'bootstrap';
const MODULE_CHAIN_STATE_CHANGES_EVENT = 'chainChanges';
const MODULE_LISK_WS_CLOSE_EVENT = 'wsConnClose';

const notFound = (err) => err && err.response && err.response.status === 404;

class ArkAdapter {
  constructor(options) {
    // { alias, config = {}, logger = console } = { config: {}, logger: console },
    this.options = options || { alias, config: {}, logger: console };
    this.alias = options.alias || DEFAULT_MODULE_ALIAS;
    this.logger = options.logger;
    this.dexWalletAddress = options.config.dexWalletAddress;
    this.chainSymbol = options.config.chainSymbol || 'ark';
    this.arkClient = new Connection(
      options.config.address || 'https://api.ark.io/api',
    );
    this.pollInterval = options.config.pollInterval || 2000;
    this.blockInterval = null;
    // this.identityManager = Identities.Keys.fromPassphrase(
    //   options.config.passphrase,
    // );

    this.transactionMapper = (transaction) => {
      // {
      //   type: 0,
      //   amount: 1000,
      //   fee: 2000,
      //   recipientId,
      //   timestamp: 121212,
      //   asset: {},
      //   senderPublicKey
      // }
      let sanitizedTransaction = {
        ...transaction,
        signatures: this.dexMultisigPublicKeys
          .map((publicKey, index) => {
            const signerAddress = getBase32AddressFromPublicKey(
              toBuffer(publicKey),
              this.chainSymbol,
            );
            return {
              signerAddress,
              publicKey,
              signature: transaction.signatures[index],
            };
          })
          .filter((signaturePacket) => signaturePacket.signature),
      };
      return transactionMapper(sanitizedTransaction);
    };

    this.MODULE_BOOTSTRAP_EVENT = MODULE_BOOTSTRAP_EVENT;
    this.MODULE_CHAIN_STATE_CHANGES_EVENT = MODULE_CHAIN_STATE_CHANGES_EVENT;
    this.MODULE_LISK_WS_CLOSE_EVENT = MODULE_LISK_WS_CLOSE_EVENT;
  }

  get dependencies() {
    return ['app'];
  }

  get info() {
    return {
      author: packageJSON.author,
      version: packageJSON.version,
      name: packageJSON.name,
    };
  }

  get events() {
    return [
      MODULE_BOOTSTRAP_EVENT,
      MODULE_CHAIN_STATE_CHANGES_EVENT,
      MODULE_LISK_WS_CLOSE_EVENT,
    ];
  }

  get actions() {
    return {
      getStatus: { handler: () => ({ version: packageJSON.version }) },
      getMultisigWalletMembers: {
        handler: (action) => this.getMultisigWalletMembers(action),
      },
      getMinMultisigRequiredSignatures: {
        handler: (action) => this.getMinMultisigRequiredSignatures(action),
      },
      getOutboundTransactions: {
        handler: (action) => this.getOutboundTransactions(action),
      },
      getInboundTransactions: {
        handler: (action) => this.getInboundTransactions(action),
      },
      getOutboundTransactionsFromBlock: {
        handler: (action) => this.getOutboundTransactionsFromBlock(action),
      },
      getLastBlockAtTimestamp: {
        handler: (action) => this.getLastBlockAtTimestamp(action),
      },
      getMaxBlockHeight: {
        handler: (action) => this.getMaxBlockHeight(action),
      },
      getBlocksBetweenHeights: {
        handler: (action) => this.getBlocksBetweenHeights(action),
      },
      getBlockAtHeight: { handler: (action) => this.getBlockAtHeight(action) },
      postTransaction: { handler: (action) => this.postTransaction(action) },
    };
  }

  isMultisigAccount(account) {
    return account.attributes?.multiSignature.length;
  }

  async getMultisigWalletMembers({ params: { walletAddress } }) {
    try {
      const account = await this.arkClient.get('wallets').get(walletAddress);
      if (account) {
        if (!this.isMultisigAccount(account)) {
          throw new InvalidActionError(
            accountWasNotMultisigError,
            `Account with address ${walletAddress} is not a multisig account`,
          );
        }
        return account.attributes.multiSignature.map(({ address }) => address);
      }
      throw new InvalidActionError(
        multisigAccountDidNotExistError,
        `Error getting multisig account with address ${walletAddress}`,
      );
    } catch (err) {
      if (err instanceof InvalidActionError) {
        throw err;
      }
      throw new InvalidActionError(
        multisigAccountDidNotExistError,
        `Error getting multisig account with address ${walletAddress}`,
        err,
      );
    }
  }

  async getMinMultisigRequiredSignatures({ params: { walletAddress } }) {
    try {
      const account = await this.arkClient.get('wallets').get(walletAddress);
      if (account) {
        if (!this.isMultisigAccount(account)) {
          throw new InvalidActionError(
            accountWasNotMultisigError,
            `Account with address ${walletAddress} is not a multisig account`,
          );
        }
        return account.attributes.multiSignature.min;
      }
      throw new InvalidActionError(
        multisigAccountDidNotExistError,
        `Error getting multisig account with address ${walletAddress}`,
      );
    } catch (err) {
      if (err instanceof InvalidActionError) {
        throw err;
      }
      throw new InvalidActionError(
        multisigAccountDidNotExistError,
        `Error getting multisig account with address ${walletAddress}`,
        err,
      );
    }
  }

  async getOutboundTransactions({ params: { walletAddress } }) {
    try {
      const transactions = await this.arkClient
        .api('wallets')
        .transactionsSent(walletAddress);
      // TODO: Fix mapper
      return transactions.map(this.transactionMapper);
    } catch (err) {
      if (notFound(err)) {
        return [];
      }
      throw new InvalidActionError(
        accountDidNotExistError,
        `Error getting outbound transactions with account address ${walletAddress}`,
        err,
      );
    }
  }

  async getInboundTransactions({ params: { walletAddress } }) {
    await this.arkClient
      .api('transactions')
      .search({ recipientId: walletAddress });
  }

  // TODO: From block not present?
  async getOutboundTransactionsFromBlock({
    params: { walletAddress, blockId },
  }) {
    await this.arkClient
      .api('transactions')
      .search({ senderId: walletAddress });
  }

  async getLastBlockAtTimestamp({ params: { timestamp } }) {
    return await this.arkClient.api('blocks').search({ timestamp });
  }

  async getMaxBlockHeight() {
    return await this.arkClient.api('blockchain');
  }

  async getBlocksBetweenHeights({ params: { fromHeight, toHeight, limit } }) {
    return await this.arkClient
      .api('blocks')
      .search({ 'height.from': fromHeight, 'height.to': toHeight, limit });
  }

  async getBlockAtHeight({ params: { height } }) {
    return await this.arkClient.api('blocks').search({ height });
  }

  async postTransaction({ params: { transaction } }) {
    await this.arkClient.api('transactions').create([transaction]);
  }

  async load(channel) {
    if (!this.dexWalletAddress) {
      throw new Error('Dex wallet address not provided in the config');
    }

    this.channel = channel;

    await this.channel.invoke('app:updateModuleState', {
      [this.alias]: {},
    });

    const account = await this.arkClient
      .api('wallets')
      .get(this.dexWalletAddress);

    if (!account.attributes?.multiSignature) {
      throw new Error('Wallet address is no multisig wallet');
    }

    this.dexNumberOfSignatures = account.attributes.multiSignature.min;
    this.dexMultisigPublicKeys = account.attributes.multiSignature.publicKeys;

    const publishBlockChangeEvent = async (eventType, block) => {
      const eventPayload = {
        type: eventType,
        block: {
          timestamp: block.timestamp.unix,
          height: block.height,
        },
      };

      await channel.publish(
        `${this.alias}:${MODULE_CHAIN_STATE_CHANGES_EVENT}`,
        eventPayload,
      );
    };

    // TODO: Poll for changes
    // await this.subscribeToBlockChange(wsClient, publishBlockChangeEvent)

    // https://api.ark.io/api/blocks?page=1&limit=100
    this.blockInterval = setInterval(async () => {
      const { data: blocks } = await this.arkClient.api('blocks').all();
      blocks.forEach(async (b) => {
        await publishBlockChangeEvent('addBlock', b);
      });
    }, this.pollInterval);
  }

  async unload() {}
}

module.exports = ArkAdapter;
