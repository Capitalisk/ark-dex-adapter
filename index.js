const crypto = require('crypto');
const { Identities, Managers } = require('capitalisk-ark-crypto');

const packageJSON = require('./package.json');
const { default: axios } = require('axios');

const DEFAULT_MODULE_ALIAS = 'ark_dex_adapter';
const DEFAULT_API_URL = 'https://api.ark.io/api';
const DEFAULT_CHAIN_SYMBOL = 'ark';
const DEX_TRANSACTION_ID_LENGTH = 44;
const UNIX_MILLISECONDS_FACTOR = 1000;
const UNIX_EPOCH_OFFSET = 1490101200;
const MAX_API_RECORDS = 100;
const MAX_TRANSACTIONS_PER_BLOCK = 500;

const MODULE_BOOTSTRAP_EVENT = 'bootstrap';

const isUnprocessable = (err) => err && err.response && err.response.status === 422;

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

class ArkDEXAdapter {
  constructor(options) {
    this.options = options || { alias, config: {}, logger: console };
    this.alias = options.alias || DEFAULT_MODULE_ALIAS;
    this.logger = options.logger || console;
    this.dexWalletAddress = options.config.dexWalletAddress;
    this.chainSymbol = options.config.chainSymbol || DEFAULT_CHAIN_SYMBOL;
    this.apiURL = options.config.apiURL || DEFAULT_API_URL;
    this.env = options.config.env || 'devnet';

    Managers.configManager.setFromPreset(this.env);
    // Needs to be set to a height which supports version 2 transactions.
    Managers.configManager.setHeight(20000000);

    this.MODULE_BOOTSTRAP_EVENT = MODULE_BOOTSTRAP_EVENT;

    this.blockMapper = (block) => {
      return {
        id: block.id,
        height: block.height,
        timestamp: block.timestamp.unix * UNIX_MILLISECONDS_FACTOR,
        numberOfTransactions: block.transactions,
      }
    };

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

      let preparedTransaction = {
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
          .filter(signaturePacket => signaturePacket.signature),
      };

      return this.sanitizeTransaction(preparedTransaction);
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
      getAccount: { handler: (action) => this.getAccount(action) },
      getBlock: { handler: (action) => this.getBlock(action) },
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
        (await axios.get(`${this.apiURL}/wallets/${query}`)).data.data || []
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
      throw new Error(
        `Failed to get multisig account with address ${
          walletAddress
        } because of error: ${
          err.message
        }`
      );
    }
  }

  async getMinMultisigRequiredSignatures({ params: { walletAddress } }) {
    try {
      const query = this.queryBuilder({
        address: walletAddress,
      });

      let account = (
        (await axios.get(`${this.apiURL}/wallets/${query}`)).data.data || []
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
      throw new Error(
        `Failed to get multisig account with address ${
          walletAddress
        } because of error: ${
          err.message
        }`
      );
    }
  }

  async getOutboundTransactions({
    params: { walletAddress, fromTimestamp, limit: totalLimit, order },
  }) {
    fromTimestamp = this.convertUnixToEpochTimestamp(fromTimestamp);
    let offset = 0;
    let transactionList = [];

    try {
      while (true) {
        const limit = Math.min(totalLimit - transactionList.length, MAX_API_RECORDS);

        if (limit <= 0) {
          break;
        }

        let queryParams = {
          offset,
          senderId: walletAddress,
          limit,
          orderBy: `nonce:${order || 'asc'}`,
        };

        if (order === 'desc') {
          queryParams['timestamp.to'] = fromTimestamp;
        } else {
          queryParams['timestamp.from'] = fromTimestamp;
        }
        const query = this.queryBuilder(queryParams);

        const result = (
          await axios.get(`${this.apiURL}/transactions${query}`)
        ).data;

        let currentTransactions = result.data || [];

        if (!currentTransactions.length) {
          break;
        }

        for (let txn of currentTransactions) {
          transactionList.push(txn);
        }

        offset += currentTransactions.length;
      }

      return transactionList.map(this.transactionMapper);

    } catch (err) {
      throw new Error(
        `Failed to get outbound transactions of account ${
          walletAddress
        } because of error: ${
          err.message
        }`
      );
    }
  }

  async getInboundTransactionsFromBlock({
    params: { walletAddress, blockId },
  }) {
    return this.getTransactionsFromBlock('inbound', walletAddress, blockId);
  }

  async getOutboundTransactionsFromBlock({
    params: { walletAddress, blockId },
  }) {
    return this.getTransactionsFromBlock('outbound', walletAddress, blockId);
  }

  async getTransactionsFromBlock(type, walletAddress, blockId) {
    let offset = 0;
    let transactionList = [];

    try {
      while (true) {
        const limit = Math.min(MAX_TRANSACTIONS_PER_BLOCK - transactionList.length, MAX_API_RECORDS);

        if (limit <= 0) {
          break;
        }

        let queryData = {
          offset,
          limit,
          blockId,
          orderBy: 'timestamp:asc',
        };

        if (type === 'inbound') {
          queryData.recipientId = walletAddress;
        } else {
          queryData.senderId = walletAddress;
        }

        const query = this.queryBuilder(queryData);

        // https://api.ark.io/api/transactions?page=1&recipientId=DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV&blockId=4b77d3f58a6fe2f150e6642dc2cd35250009fb4e6b41927a3427e10bc2ca821b
        const result = (
          await axios.get(`${this.apiURL}/transactions${query}`)
        ).data;

        let currentTransactions = result.data || [];

        if (!currentTransactions.length) {
          break;
        }

        for (let txn of currentTransactions) {
          transactionList.push(txn);
        }

        offset += currentTransactions.length;
      }

      return transactionList.map(this.transactionMapper);

    } catch (err) {
      throw new Error(
        `Failed to get ${
          type
        } transactions of account ${
          walletAddress
        } because of error: ${
          err.message
        }`
      );
    }
  }

  async getMaxBlockHeight() {
    return (await axios.get(`${this.apiURL}/blockchain`)).data.data.block.height;
  }

  async getBlocksBetweenHeights({ params: { fromHeight, toHeight, limit } }) {
    const query = this.queryBuilder({
      'height.from': fromHeight + 1,
      'height.to': toHeight,
      orderBy: 'height:asc',
      limit,
    });

    const {
      data: { data },
    } = await axios.get(`${this.apiURL}/blocks/${query}`);

    return data.map(this.blockMapper);
  }

  async getBlockAtHeight({ params: { height } }) {
    const query = this.queryBuilder({
      height,
    });

    const {
      data: { data },
    } = await axios.get(`${this.apiURL}/blocks${query}`);

    if (data.length) {
      return data.map(this.blockMapper)[0];
    }

    throw new InvalidActionError(
      blockDidNotExistError,
      `Error getting block at height ${height}`,
    );
  }

  async postTransaction({ params: { transaction } }) {
    const signaturePacketList = transaction.signatures || [];
    const publicKeySignatures = {};
    for (let signaturePacket of signaturePacketList) {
        publicKeySignatures[signaturePacket.publicKey] = signaturePacket;
    }

    const signatures = this.dexMultisigPublicKeys.map((memberPublicKey) => {
      let signaturePacket = publicKeySignatures[memberPublicKey];
      return signaturePacket && signaturePacket.signature;
    }).filter(signature => signature);

    const signedTxn = {
      id: transaction.originalId,
      version: transaction.version,
      network: transaction.network,
      type: transaction.type,
      typeGroup: transaction.typeGroup,
      senderPublicKey: transaction.senderPublicKey,
      recipientId: transaction.recipientAddress,
      amount: transaction.amount,
      fee: transaction.fee,
      expiration: transaction.expiration,
      nonce: transaction.nonce,
      vendorField: transaction.message,
      signatures,
    };
    try {
      const response = await axios.post(`${this.apiURL}/transactions`, {
        transactions: [signedTxn],
      });
      if (response.data.errors) {
        let firstError = Object.values(response.data.errors)[0] || {};
        let firstErrorMessage = firstError.message || 'Unknown error';
        throw new InvalidActionError(
          transactionBroadcastError,
          firstErrorMessage
        );
      }
    } catch (err) {
      if (err instanceof InvalidActionError) {
        throw err;
      }
      if (isUnprocessable(err)) {
        throw new InvalidActionError(
          transactionBroadcastError,
          `Transaction could not be posted because of error: ${
            err.message
          }`
        );
      }
      throw new Error(
        `Failed to post transaction ${transaction.id} because of error: ${err.message}`
      );
    }
  }

  async getAccount({ params: { walletAddress } }) {
    try {
      const query = this.queryBuilder({
        address: walletAddress,
      });

      let account = (
        (await axios.get(`${this.apiURL}/wallets/${query}`)).data.data || []
      )[0];

      if (!account) {
        throw new InvalidActionError(
          accountDidNotExistError,
          `Error getting account with address ${walletAddress}`
        );
      }
      return account;

    } catch (err) {
      if (err instanceof InvalidActionError) {
        throw err;
      }
      throw new Error(
        `Failed to get account with address ${
          walletAddress
        } because of error: ${
          err.message
        }`
      );
    }
  }

  async getBlock({ params: { blockId } }) {
    try {
      const query = this.queryBuilder({
        id: blockId,
      });

      let block = (
        (await axios.get(`${this.apiURL}/blocks/${query}`)).data.data || []
      )[0];

      if (!block) {
        throw new InvalidActionError(
          blockDidNotExistError,
          `Error getting block with ID ${blockId}`,
        );
      }
      return this.blockMapper(block);

    } catch (err) {
      if (err instanceof InvalidActionError) {
        throw err;
      }
      throw new Error(
        `Failed to get block with ID ${
          blockId
        } because of error: ${
          err.message
        }`
      );
    }
  }

  async getRequiredDEXWalletInformation() {
    let account;
    try {
      account = (
        await axios.get(`${this.apiURL}/wallets/${this.dexWalletAddress}`)
      ).data.data;
    } catch (error) {
      throw new Error(
        `Failed to fetch info for the DEX wallet ${
          this.dexWalletAddress
        } because of error: ${
          error.message
        }`
      );
    }

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
      throw new Error('DEX wallet address was not provided in the config');
    }

    await this.getRequiredDEXWalletInformation();

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
      if (i !== 0) query += '&';

      query += `${key}=${value}`;
    });

    return query;
  }

  sanitizeTransaction(txn) {
    return {
      id: this.computeDEXTransactionId(txn.sender, txn.nonce),
      originalId: txn.id,
      amount: txn.amount,
      senderAddress: txn.sender,
      recipientAddress: txn.recipient,
      blockId: txn.blockId,
      timestamp: txn.timestamp.unix * UNIX_MILLISECONDS_FACTOR,
      message: txn.vendorField || '',
      signatures: txn.signatures,
      nonce: txn.nonce,
    };
  }

  convertUnixToEpochTimestamp(unixTimestamp) {
    let epochTimestamp = Math.round(unixTimestamp / UNIX_MILLISECONDS_FACTOR) - UNIX_EPOCH_OFFSET;
    return epochTimestamp < 0 ? 0 : epochTimestamp;
  }

  convertEpochToUnixTimestamp(epochTimestamp) {
    return (epochTimestamp + UNIX_EPOCH_OFFSET) * UNIX_MILLISECONDS_FACTOR;
  }

  computeDEXTransactionId(senderAddress, nonce) {
    return crypto.createHash('sha256').update(`${senderAddress}-${nonce}`).digest('hex');
  }
}

module.exports = ArkDEXAdapter;
