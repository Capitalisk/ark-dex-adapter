// 'use strict';

const crypto = require('crypto');
const { Identities } = require('@arkecosystem/crypto');

const packageJSON = require('./package.json');
const { default: axios } = require('axios');

const DEFAULT_MODULE_ALIAS = 'ark_dex_adapter';
const DEFAULT_ADDRESS = 'https://api.ark.io/api';
const DEFAULT_CHAIN_SYMBOL = 'ark';
const DEX_TRANSACTION_ID_LENGTH = 44;

const MODULE_BOOTSTRAP_EVENT = 'bootstrap';
const MODULE_CHAIN_STATE_CHANGES_EVENT = 'chainChanges';

const notFound = (err) => err && err.response && err.response.status === 404;

class InvalidActionError extends Error {
  constructor(name, message, cause) {
    super(message);
    this.type = 'InvalidActionError';
    this.name = name;
    this.cause = cause;
  }

  toString() {
    return JSON.stringify({
      name: this.name,
      type: this.type,
      message: this.message,
      cause: this.cause,
    });
  }
}

const multisigAccountDidNotExistError = 'MultisigAccountDidNotExistError';
const accountDidNotExistError = 'AccountDidNotExistError';
const accountWasNotMultisigError = 'AccountWasNotMultisigError';
const blockDidNotExistError = 'BlockDidNotExistError';
const transactionDidNotExistError = 'TransactionDidNotExistError';
const transactionBroadcastError = 'TransactionBroadcastError';

class ArkAdapter {
  constructor(options) {
    this.options = options || { alias, config: {}, logger: console };
    this.alias = options.alias || DEFAULT_MODULE_ALIAS;
    this.logger = options.logger || console;
    this.dexWalletAddress = options.config.dexWalletAddress;
    this.chainSymbol = options.config.chainSymbol || DEFAULT_CHAIN_SYMBOL;
    this.arkAddress = options.config.address || DEFAULT_ADDRESS;
    this.chainPollingInterval = null;
    this.pollingInterval = options.config.pollingInterval || 10000;

    this.getRequiredDexWalletInformation();

    this.MODULE_BOOTSTRAP_EVENT = MODULE_BOOTSTRAP_EVENT;
    this.MODULE_CHAIN_STATE_CHANGES_EVENT = MODULE_CHAIN_STATE_CHANGES_EVENT;

    this.transactionMapper = (transaction) => {
      // this.dexMultisigPublicKeys needs to await it's Promise, if it isn't available yet, recall the function until it is available.
      if (!this.dexMultisigPublicKeys)
        setTimeout(() => this.transactionMapper(transaction), 200);

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

      return this.sanitizeTransaction(sanitizedTransaction);
    };
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
      getInboundTransactionsFromBlock: {
        handler: (action) => this.getInboundTransactionsFromBlock(action),
      },
      getOutboundTransactionsFromBlock: {
        handler: (action) => this.getOutboundTransactionsFromBlock(action),
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
      const query = this.queryBuilder({
        address: walletAddress,
      });

      const account = (await axios.get(`${this.arkAddress}/wallets/${query}`))
        .data.data?.[0];

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
      const query = this.queryBuilder({
        address: walletAddress,
      });

      let account = (await axios.get(`${this.arkAddress}/wallets/${query}`))
        .data.data?.[0];

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

  // Timestamp is epoch by default on Ark
  async getOutboundTransactions({
    params: { walletAddress, fromTimestamp, limit, order },
  }) {
    try {
      const query = this.queryBuilder({
        page: 1,
        senderId: walletAddress,
        'timestamp.from': fromTimestamp,
        limit,
        orderBy: order,
      });

      const transactions = (
        await axios.get(`${this.arkAddress}/transactions${query}`)
      ).data.data;

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

  async getInboundTransactions({
    params: { walletAddress, fromTimestamp, limit, order },
  }) {
    try {
      const query = this.queryBuilder({
        page: 1,
        recipientId: walletAddress,
        'timestamp.from': fromTimestamp,
        limit,
        orderBy: order,
      });

      // https://api.ark.io/api/transactions?page=1&recipientId=AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX&timestamp.from=121676312&limit=100
      const transactions = (
        await axios.get(`${this.arkAddress}/transactions${query}`)
      ).data.data;

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

  async getInboundTransactionsFromBlock({
    params: { walletAddress, blockId },
  }) {
    try {
      const query = this.queryBuilder({
        page: 1,
        recipientId: walletAddress,
        blockId,
      });

      // https://api.ark.io/api/transactions?page=1&recipientId=AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX&blockId=428298302dd08c34c59ce46f55c0fffecc1e2ffa30ec194fe9a99d2b4efe8e4f
      const transactions = (
        await axios.get(`${this.arkAddress}/transactions${query}`)
      ).data.data;

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

  async getOutboundTransactionsFromBlock({
    params: { walletAddress, blockId },
  }) {
    try {
      const query = this.queryBuilder({
        page: 1,
        senderId: walletAddress,
        blockId,
      });

      // https://api.ark.io/api/transactions?page=1&senderId=AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX&blockId=d77063512b4e3e539aa8eaaf3a8646a15e94efee564e3e0c9e8f0639fee76115
      const transactions = (
        await axios.get(`${this.arkAddress}/transactions${query}`)
      ).data.data;

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

  async getMaxBlockHeight() {
    return (await axios.get(`${this.arkAddress}/blockchain`)).data.data.block
      .height;
  }

  async getBlocksBetweenHeights({ params: { fromHeight, toHeight, limit } }) {
    const query = this.queryBuilder({
      'height.from': fromHeight,
      'height.to': toHeight,
      limit,
    });

    const {
      data: { data },
    } = await axios.get(`${this.arkAddress}/blocks/${query}`);

    return data.map((b) => ({ ...b, timestamp: b.timestamp.unix }));
  }

  async getBlockAtHeight({ params: { height } }) {
    const query = this.queryBuilder({
      height,
    });

    const {
      data: { data },
    } = await axios.get(`${this.arkAddress}/blocks${query}`);

    if (data.length) {
      return data.map((b) => ({ ...b, timestamp: b.timestamp.unix }))[0];
    }

    throw new InvalidActionError(
      blockDidNotExistError,
      `Error getting block at height ${height}`,
    );
  }

  async postTransaction({ params: { transaction } }) {
    // TODO: axios POST
    const {
      data: { data },
    } = axios.post(`${this.arkAddress}/transactions`, {
      body: {
        transactions: [transaction],
      },
    });

    if (data.length) {
      return data[0];
    }

    throw new InvalidActionError(
      transactionBroadcastError,
      `Error broadcasting transaction to the ark network`,
    );
  }

  async getRequiredDexWalletInformation() {
    const account = (
      await axios.get(`${this.arkAddress}/wallets/${this.dexWalletAddress}`)
    ).data.data;

    if (!account.attributes?.multiSignature) {
      throw new Error('Wallet address is no multisig wallet');
    }

    this.dexNumberOfSignatures = account.attributes.multiSignature.min;
    this.dexMultisigPublicKeys = account.attributes.multiSignature.publicKeys;
  }

  async publishNewBlocks() {
    const blocks = (await axios.get(`${this.arkAddress}/blocks?limit=20`)).data
      .data;

    blocks.forEach((b) => {
      const eventPayload = {
        type: 'addBlock',
        block: {
          timestamp: b.timestamp.unix,
          height: b.height,
        },
      };

      this.channel.publish(
        `${this.alias}:${MODULE_CHAIN_STATE_CHANGES_EVENT}`,
        eventPayload,
      );
    });
  }

  async load(channel) {
    if (!this.dexWalletAddress) {
      throw new Error('Dex wallet address not provided in the config');
    }

    this.channel = channel;

    await this.channel.invoke('app:updateModuleState', {
      [this.alias]: {},
    });

    await channel.publish(`${this.alias}:${MODULE_BOOTSTRAP_EVENT}`);

    await this.publishNewBlocks();

    this.chainPollingInterval = setInterval(
      () => this.publishNewBlocks,
      this.pollingInterval,
    );
  }

  async unload() {
    clearInterval(this.chainPollingInterval);
  }

  queryBuilder(args) {
    let query = '?';

    Object.entries(args).forEach(([key, value], i) => {
      if (!value && value !== 0) return;
      if (key === 'orderBy') value = 'timestamp:' + value;
      if (i !== 0) query += '&';

      query += `${key}=${value}`;
    });

    return query;
  }

  computeDEXTransactionId(senderAddress, nonce) {
    return crypto
      .createHash('sha256')
      .update(`${senderAddress}-${nonce}`)
      .digest('hex')
      .slice(0, DEX_TRANSACTION_ID_LENGTH);
  }

  sanitizeTransaction(t) {
    return {
      id: this.computeDEXTransactionId(t.sender, t.nonce),
      message: t.vendorField || '',
      amount: t.amount,
      timestamp: t.timestamp.unix,
      senderAddress: t.sender,
      recipientAddress: t.recipient,
      signatures: t.signatures,
      nonce: t.nonce,
    };
  }

  blockMapper({ id, height, timestamp, numberOfTransactions }) {
    return {
      id,
      height,
      timestamp,
      numberOfTransactions,
    };
  }
}

module.exports = ArkAdapter;
