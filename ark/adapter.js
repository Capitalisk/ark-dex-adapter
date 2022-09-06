// 'use strict';

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

    this.getRequiredDexWalletInformation();

    this.transactionMapper = (transaction) => {
      // {
      //   amount: '0'
      //   asset: {
      //     multiSignature: {
      //       publicKeys: [
      //        '02bb3481404dfc0e441fa6dac4a5eae9c218c6145d09522e0ebe4aa944315dac26',
      //        '02a2390273dca76d9e2ec9b5b181294d7e1251f5f4e8e268ef062ec00c98e13480'
      //       ],
      //       min: 2
      //     }
      //   }
      //   blockId: 'dde02302a0932faac303432bfb4c1251cb96f55e5c926f4f586279ec332a1c3b'
      //   confirmations: 441
      //   fee: '1500000000'
      //   id: '37e301056d1277ab3ae7ea382d4572671ff804e0ece9cb4a64331b346fa1de2d'
      //   nonce: '3'
      //   recipient: 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV'
      //   sender: 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV'
      //   senderPublicKey: '02bb3481404dfc0e441fa6dac4a5eae9c218c6145d09522e0ebe4aa944315dac26'
      //   signature: '71a6891beca95bea12272d65f46c4028d46c7c874b3832e9691f403b294dd63e4f59963f090e3663a6c6c9ecd7afcf65020d7cd5d42167c325f5540407469637'
      //   signatures: (2) ['0002861522b4f7625d23a7f8b24d474b15ef301dc5b159fbb…745a25725a9142222f9414aea34f470ffab2540fccd92820', '01746213b2b9c98649b87dff39b2851db45dd407373f9b3f8…f38b40c90e980107506bfea1a26119b42b8dae70c606cd53']
      //   signSignature: '6b087c021e41a7d609ee95c8fc59e904305999836452187c175b9e27fb6c94ef25e57773b99a6b446812c7d91a10ad3a15cee5a57ea783455dbdbfae4b4408d5'
      //   timestamp: {epoch: 172375336, unix: 1662476536, human: '2022-09-06T15:02:16.000Z'}
      //   type: 4
      //   typeGroup: 1
      //   version: 2
      // }
      let sanitizedTransaction = {
        ...transaction,
        signatures: this.dexMultisigPublicKeys
          .map((publicKey, index) => {
            const signerAddress = Identities.Address.fromPublicKey(publicKey);

            return {
              signerAddress,
              publicKey,
              signature:
                transaction.signatures?.[index] || transaction.signature,
            };
          })
          .filter((signaturePacket) => signaturePacket.signature),
      };

      // return sanitizedTransaction;
      // TODO: fix this
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
    return !!account.attributes.multiSignature;
  }

  async getMultisigWalletMembers({ params: { walletAddress } }) {
    try {
      const account = this.sanitateResponse(
        await this.arkClient.api('wallets').get(walletAddress),
      );

      if (account) {
        if (!this.isMultisigAccount(account)) {
          throw new InvalidActionError(
            accountWasNotMultisigError,
            `Account with address ${walletAddress} is not a multisig account`,
          );
        }

        return account.attributes.multiSignature.publicKeys.map((k) =>
          Identities.Address.fromPublicKey(k),
        );
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
      const account = this.sanitateResponse(
        await this.arkClient.api('wallets').get(walletAddress),
      );

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
      const transactions = this.sanitateResponse(
        await this.arkClient.api('wallets').transactionsSent(walletAddress),
      );

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

  sanitateResponse(response) {
    return response.body.data;
  }

  async getLastBlockAtTimestamp({ params: { timestamp } }) {
    return this.sanitateResponse(
      await this.arkClient.api('blocks').search({ timestamp }),
    );
  }

  async getMaxBlockHeight() {
    return this.sanitateResponse(await this.arkClient.api('blockchain'));
  }

  async getBlocksBetweenHeights({ params: { fromHeight, toHeight, limit } }) {
    return this.sanitateResponse(await this.arkClien)
      .api('blocks')
      .search({ 'height.from': fromHeight, 'height.to': toHeight, limit });
  }

  async getBlockAtHeight({ params: { height } }) {
    return this.sanitateResponse(
      await this.arkClient.api('blocks').search({ height }),
    );
  }

  async postTransaction({ params: { transaction } }) {
    return this.sanitateResponse(
      await this.arkClient.api('transactions').create([transaction]),
    );
  }

  async getRequiredDexWalletInformation() {
    const account = this.sanitateResponse(
      await this.arkClient.api('wallets').get(this.dexWalletAddress),
    );

    if (!account.attributes?.multiSignature) {
      throw new Error('Wallet address is no multisig wallet');
    }

    this.dexNumberOfSignatures = account.attributes.multiSignature.min;
    this.dexMultisigPublicKeys = account.attributes.multiSignature.publicKeys;
  }

  async load(channel) {
    if (!this.dexWalletAddress) {
      throw new Error('Dex wallet address not provided in the config');
    }

    this.channel = channel;

    await this.channel.invoke('app:updateModuleState', {
      [this.alias]: {},
    });

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
