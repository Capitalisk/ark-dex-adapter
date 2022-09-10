// 'use strict';

const crypto = require('crypto');
const { Identities } = require('@arkecosystem/crypto');

const packageJSON = require('./package.json');
const { default: axios } = require('axios');

const DEFAULT_MODULE_ALIAS = 'ark_dex_adapter';
const DEFAULT_ADDRESS = 'https://api.ark.io/api';
const DEFAULT_CHAIN_SYMBOL = 'ark';
const DEX_TRANSACTION_ID_LENGTH = 44;
const UNIX_MILLISECONDS_FACTOR = 1000;
const UNIX_EPOCH_OFFSET = 1490101200;
const MIN_API_RECORDS = 1;
const MAX_API_RECORDS = 100;
const MAX_TRANSACTIONS_PER_BLOCK = 500;

const MODULE_BOOTSTRAP_EVENT = 'bootstrap';

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

    this.MODULE_BOOTSTRAP_EVENT = MODULE_BOOTSTRAP_EVENT;

    this.transactionMapper = (transaction) => {
      let signatureList = transaction.signatures || [];
      let sparseSignatureList = [];
      for (let signature of signatureList) {
        if (typeof signature !== 'string') {
          continue;
        }
        let index = parseInt(signature.slice(0, 2), 16);
        sparseSignatureList[index] = signature;
      }

      let sanitizedTransaction = {
        ...transaction,
        signatures: this.dexMultisigPublicKeys
          .map((publicKey, index) => {
            const signerAddress = Identities.Address.fromPublicKey(publicKey);

            return {
              signerAddress,
              publicKey,
              signature: sparseSignatureList[index],
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

      const account = (
        (await axios.get(`${this.arkAddress}/wallets/${query}`)).data.data || []
      )[0];

      if (account) {
        if (!this.isMultisigAccount(account)) {
          throw new InvalidActionError(
            accountWasNotMultisigError,
            `Account with address ${walletAddress} was not a multisig account`,
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

      let account = (
        (await axios.get(`${this.arkAddress}/wallets/${query}`)).data.data || []
      )[0];

      if (account) {
        if (!this.isMultisigAccount(account)) {
          throw new InvalidActionError(
            accountWasNotMultisigError,
            `Account with address ${walletAddress} was not a multisig account`,
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

  async getOutboundTransactions({
    params: { walletAddress, fromTimestamp, limit, order },
  }) {
    fromTimestamp = this.convertUnixToEpochTimestamp(fromTimestamp);
    try {
      let queryParams = {
        page: 1,
        senderId: walletAddress,
        limit,
        orderBy: order || 'asc',
      };
      if (order === 'desc') {
        queryParams['timestamp.to'] = fromTimestamp;
      } else {
        queryParams['timestamp.from'] = fromTimestamp;
      }
      const query = this.queryBuilder(queryParams);

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
    fromTimestamp = this.convertUnixToEpochTimestamp(fromTimestamp);
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
      let page = 0;
      let pageCount = 1;
      let transactionList = [];

      while (++page <= pageCount && transactionList.length < MAX_TRANSACTIONS_PER_BLOCK) {
        const limit = Math.max(Math.min(MAX_TRANSACTIONS_PER_BLOCK - transactionList.length, MAX_API_RECORDS), MIN_API_RECORDS);
        const query = this.queryBuilder({
          page,
          limit,
          recipientId: walletAddress,
          blockId,
        });

        // https://api.ark.io/api/transactions?page=1&recipientId=DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV&blockId=4b77d3f58a6fe2f150e6642dc2cd35250009fb4e6b41927a3427e10bc2ca821b
        const response = (
          await axios.get(`${this.arkAddress}/transactions${query}`)
        ).data;

        let currentTransactions = response.data || [];

        for (let txn of currentTransactions) {
          transactionList.push(txn);
        }
        pageCount = (response.meta || {}).pageCount;
      }

      return transactionList.map(this.transactionMapper);
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
      let page = 0;
      let pageCount = 1;
      let transactionList = [];

      while (++page <= pageCount && transactionList.length < MAX_TRANSACTIONS_PER_BLOCK) {
        const limit = Math.max(Math.min(MAX_TRANSACTIONS_PER_BLOCK - transactionList.length, MAX_API_RECORDS), MIN_API_RECORDS);
        const query = this.queryBuilder({
          page,
          limit,
          senderId: walletAddress,
          blockId,
        });

        // https://api.ark.io/api/transactions?page=1&senderId=AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX&blockId=d77063512b4e3e539aa8eaaf3a8646a15e94efee564e3e0c9e8f0639fee76115
        const response = (
          await axios.get(`${this.arkAddress}/transactions${query}`)
        ).data;

        let currentTransactions = response.data || [];

        for (let txn of currentTransactions) {
          transactionList.push(txn);
        }
        pageCount = (response.meta || {}).pageCount;
      }

      return transactionList.map(this.transactionMapper);
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
      'height.from': fromHeight + 1,
      'height.to': toHeight,
      orderBy: 'asc',
      limit,
    });

    const {
      data: { data },
    } = await axios.get(`${this.arkAddress}/blocks/${query}`);

    return data.map((b) => ({ ...b, timestamp: b.timestamp.unix * UNIX_MILLISECONDS_FACTOR }));
  }

  async getBlockAtHeight({ params: { height } }) {
    const query = this.queryBuilder({
      height,
    });

    const {
      data: { data },
    } = await axios.get(`${this.arkAddress}/blocks${query}`);

    if (data.length) {
      return data.map((b) => ({ ...b, timestamp: b.timestamp.unix * UNIX_MILLISECONDS_FACTOR }))[0];
    }

    throw new InvalidActionError(
      blockDidNotExistError,
      `Error getting block at height ${height}`,
    );
  }

  async postTransaction({ params: { transaction } }) {
    try {
      const response = await axios.post(`${this.arkAddress}/transactions`, {
        transactions: [transaction],
      });
      if (response.data.errors) {
        let firstError = Object.values(response.data.errors)[0] || {};
        let firstErrorMessage = firstError.message || 'Unknown error';
        throw new Error(firstErrorMessage);
      }
    } catch (error) {
      let errorMessage = error.response && error.response.data && error.response.data.message ?
        `${error.message} - ${error.response.data.message}` : error.message;
      throw new InvalidActionError(
        transactionBroadcastError,
        `Error broadcasting transaction to the ark network because of error: ${errorMessage}`,
      );
    }
  }

  async getRequiredDexWalletInformation() {
    const account = (
      await axios.get(`${this.arkAddress}/wallets/${this.dexWalletAddress}`)
    ).data.data;

    if (!account) {
      throw new Error(`Account ${this.dexWalletAddress} could not be found`);
    }

    if (!account.attributes || !account.attributes.multiSignature) {
      throw new Error('Wallet address was not a multisig wallet');
    }

    this.dexNumberOfSignatures = account.attributes.multiSignature.min;
    this.dexMultisigPublicKeys = account.attributes.multiSignature.publicKeys;
  }

  async load(channel) {
    if (!this.dexWalletAddress) {
      throw new Error('Dex wallet address not provided in the config');
    }

    this.getRequiredDexWalletInformation();

    this.channel = channel;

    await this.channel.invoke('app:updateModuleState', {
      [this.alias]: {},
    });

    await channel.publish(`${this.alias}:${MODULE_BOOTSTRAP_EVENT}`);
  }

  async unload() {}

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

  sanitizeTransaction(t) {
    return {
      id: t.id,
      message: t.vendorField || '',
      amount: t.amount,
      timestamp: t.timestamp.unix * UNIX_MILLISECONDS_FACTOR,
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

  convertUnixToEpochTimestamp(unixTimestamp) {
    let epochTimestamp = Math.round(unixTimestamp / UNIX_MILLISECONDS_FACTOR) - UNIX_EPOCH_OFFSET;
    return epochTimestamp < 0 ? 0 : epochTimestamp;
  }

  convertEpochToUnixTimestamp(epochTimestamp) {
    return (epochTimestamp + UNIX_EPOCH_OFFSET) * UNIX_MILLISECONDS_FACTOR;
  }
}

module.exports = ArkAdapter;
