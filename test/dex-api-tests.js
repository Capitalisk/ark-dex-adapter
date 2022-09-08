const assert = require('assert');

const ArkDEXAdapter = require('../index');
const Channel = require('./utils/channel');
const AppModuleMock = require('./utils/app');

const wait = (duration) =>
  new Promise((resolve) => setTimeout(resolve, duration));

// This test suite can be adapted to check whether or not a custom chain module is compatible with Lisk DEX.
// All the boilerplate can be modified except the 'it' blocks where the assertions are made.
// If a module passes all the test case cases in this file, then it is compatible with Lisk DEX.

describe('DEX API tests', async () => {
  let adapterModule;
  let bootstrapEventTriggered;
  let chainChangeEvents = [];

  before(async () => {
    adapterModule = new ArkDEXAdapter({
      config: {
        env: 'test',
        dexWalletAddress: 'DMwCauULKf1edh4WVTYVEfZt9CouMqxDuV',
        address: 'https://dapi.ark.io/api',
      },
      logger: {
        info: () => {},
        // info: (...args) => console.info.apply(console, args),
        debug: () => {},
        // debug: (...args) => console.debug.apply(console, args),
        warn: (...args) => console.warn.apply(console, args),
        error: (...args) => console.error.apply(console, args),
      },
    });

    this.channel = new Channel({
      modules: {
        app: new AppModuleMock(),
      },
    });

    this.channel.subscribe(
      `${adapterModule.alias}:${adapterModule.MODULE_BOOTSTRAP_EVENT}`,
      () => {
        bootstrapEventTriggered = true;
      },
    );

    this.channel.subscribe(
      `${adapterModule.alias}:${adapterModule.MODULE_CHAIN_STATE_CHANGES_EVENT}`,
      (payload) => {
        chainChangeEvents.push(payload);
      },
    );

    await adapterModule.load(this.channel);
  });

  after(async () => {
    await adapterModule.unload();
  });

  describe('module state', () => {
    it('should expose an info property', () => {
      let moduleInfo = adapterModule.info;
      assert(moduleInfo.author);
      assert(moduleInfo.version);
      assert(moduleInfo.name);
    });

    it('should expose an alias property', () => {
      assert(adapterModule.alias);
    });

    it('should expose an events property', () => {
      let events = adapterModule.events;
      assert(events.includes('bootstrap'));
      assert(events.includes('chainChanges'));
    });
  });

  describe('module actions', async () => {
    describe('getMultisigWalletMembers action', async () => {
      const multiSigWalletAddress = 'DMwCauULKf1edh4WVTYVEfZt9CouMqxDuV';

      it('should return an array of member addresses', async () => {
        let walletMembers =
          await adapterModule.actions.getMultisigWalletMembers.handler({
            params: {
              walletAddress: multiSigWalletAddress,
            },
          });

        const memberAddessList = [
          'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV',
          'DRzgcj97d3hFdLJjYhPTdBQNVeb92mzrx5',
        ];

        // Must be an array of wallet address strings.
        assert.strictEqual(
          JSON.stringify(walletMembers.sort()),
          JSON.stringify(memberAddessList.sort()),
        );
      });

      it('should throw a MultisigAccountDidNotExistError if the multisig wallet address does not exist', async () => {
        let caughtError = null;
        try {
          await adapterModule.actions.getMultisigWalletMembers.handler({
            params: {
              walletAddress: 'ldpos6312b77c6ca4233141835eb37f8f33a45f18d50f',
            },
          });
        } catch (error) {
          caughtError = error;
        }
        assert.notStrictEqual(caughtError, null);
        assert.strictEqual(caughtError.type, 'InvalidActionError');
        assert.strictEqual(caughtError.name, 'MultisigAccountDidNotExistError');
      });
    });

    describe('getMinMultisigRequiredSignatures action', async () => {
      const multiSigWalletAddress = 'DMwCauULKf1edh4WVTYVEfZt9CouMqxDuV';

      it('should return the number of required signatures', async () => {
        let requiredSignatureCount =
          await adapterModule.actions.getMinMultisigRequiredSignatures.handler({
            params: {
              walletAddress: multiSigWalletAddress,
            },
          });
        assert.strictEqual(requiredSignatureCount, 2);
      });

      it('should throw an AccountDidNotExistError if the wallet address does not exist', async () => {
        let caughtError = null;
        try {
          await adapterModule.actions.getMinMultisigRequiredSignatures.handler({
            params: {
              walletAddress: 'ldpos6312b77c6ca4233141835eb37f8f33a45f18d50f',
            },
          });
        } catch (error) {
          caughtError = error;
        }
        assert.notStrictEqual(caughtError, null);
        assert.strictEqual(caughtError.type, 'InvalidActionError');
        assert.strictEqual(caughtError.name, 'MultisigAccountDidNotExistError');
      });

      it('should throw an AccountWasNotMultisigError if the account is not a multisig wallet', async () => {
        let caughtError = null;
        try {
          await adapterModule.actions.getMinMultisigRequiredSignatures.handler({
            params: {
              walletAddress: 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV',
            },
          });
        } catch (error) {
          caughtError = error;
        }
        assert.notStrictEqual(caughtError, null);
        assert.strictEqual(caughtError.type, 'InvalidActionError');
        assert.strictEqual(caughtError.name, 'AccountWasNotMultisigError');
      });
    });

    describe('getOutboundTransactions action', async () => {
      const senderWalletAddress = 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV';

      it('should return an array of transactions sent from the specified walletAddress', async () => {
        let transactions =
          await adapterModule.actions.getOutboundTransactions.handler({
            params: {
              walletAddress: senderWalletAddress,
              fromTimestamp: 0,
              limit: 3,
            },
          });
        assert(Array.isArray(transactions));
        assert.strictEqual(transactions.length, 3);
        assert.strictEqual(transactions[0].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[0].message, 'ihsdaoidhsaohdas');
        assert.strictEqual(transactions[1].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[1].message, '');
        assert.strictEqual(transactions[2].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[2].message, '');

        for (let txn of transactions) {
          assert.strictEqual(typeof txn.id, 'string');
          assert.strictEqual(typeof txn.message, 'string');
          assert.strictEqual(typeof txn.amount, 'string');
          assert.strictEqual(Number.isNaN(Number(txn.amount)), false);
          assert.strictEqual(Number.isInteger(txn.timestamp), true);
        }
      });

      // TODO: Default is desc
      // Check how DEX needs to handle that
      // See both tests below, one expects asc while the API returns DESC
      // The other expects DESC and needs ASC for it to pass
      // FIXME: Using DESC Rather than ASC by default
      it('should return transactions which are greater than fromTimestamp by default in asc order', async () => {
        let transactions =
          await adapterModule.actions.getOutboundTransactions.handler({
            params: {
              walletAddress: senderWalletAddress,
              fromTimestamp: 0,
              limit: 3,
            },
          });

        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 3);
        assert.strictEqual(transactions[0].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[0].timestamp, 1662560648);
        assert.strictEqual(transactions[1].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[1].timestamp, 1662500592);
        assert.strictEqual(transactions[2].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[2].timestamp, 1662476536);
      });

      it('should return transactions are lower than than fromTimestamp when order is desc', async () => {
        let transactions =
          await adapterModule.actions.getOutboundTransactions.handler({
            params: {
              walletAddress: senderWalletAddress,
              fromTimestamp: 172374440,
              limit: 3,
              order: 'desc',
            },
          });

        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 3);
        assert.strictEqual(transactions[0].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[0].timestamp, 1662560648);
        assert.strictEqual(transactions[1].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[1].timestamp, 1662500592);
        assert.strictEqual(transactions[2].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[2].timestamp, 1662476536);
      });

      it('should limit the number of transactions based on the specified limit', async () => {
        let transactions =
          await adapterModule.actions.getOutboundTransactions.handler({
            params: {
              walletAddress: senderWalletAddress,
              fromTimestamp: 0,
              limit: 1,
            },
          });
        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 1);
        assert.strictEqual(transactions[0].senderAddress, senderWalletAddress);
        assert.strictEqual(transactions[0].message, 'ihsdaoidhsaohdas');
      });

      it('should return an empty array if no transactions can be matched', async () => {
        let transactions =
          await adapterModule.actions.getOutboundTransactions.handler({
            params: {
              walletAddress: senderWalletAddress,
              fromTimestamp: 213123213,
              limit: 100,
            },
          });
        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 0);
      });
    });

    describe('getInboundTransactionsFromBlock action', async () => {
      it('should return an array of transactions sent to the specified walletAddress', async () => {
        let recipientAddress = 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV';
        let transactions =
          await adapterModule.actions.getInboundTransactionsFromBlock.handler({
            params: {
              walletAddress: recipientAddress,
              blockId:
                '4b77d3f58a6fe2f150e6642dc2cd35250009fb4e6b41927a3427e10bc2ca821b',
            },
          });
        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 1);
        let txn = transactions[0];

        assert.strictEqual(typeof txn.id, 'string');
        assert.strictEqual(typeof txn.message, 'string');
        assert.strictEqual(typeof txn.amount, 'string');
        assert.strictEqual(Number.isNaN(Number(txn.amount)), false);
        assert.strictEqual(Number.isInteger(txn.timestamp), true);
        assert.strictEqual(typeof txn.senderAddress, 'string');
        assert.strictEqual(typeof txn.recipientAddress, 'string');

        assert.strictEqual(transactions[0].recipientAddress, recipientAddress);
        assert.strictEqual(transactions[0].message, '');
      });

      it('should return an empty array if no transactions match the specified blockId', async () => {
        let recipientAddress = 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV';
        let transactions =
          await adapterModule.actions.getInboundTransactionsFromBlock.handler({
            params: {
              walletAddress: recipientAddress,
              blockId:
                'd77063512b4e3e539aa8eaaf3a8646a15e94efee564e3e0c9e8f0639fee76115',
            },
          });
        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 0);
      });

      it('should return an empty array if no transactions match the specified walletAddress', async () => {
        let transactions =
          await adapterModule.actions.getInboundTransactionsFromBlock.handler({
            params: {
              walletAddress: 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzv',
              blockId:
                '4b77d3f58a6fe2f150e6642dc2cd35250009fb4e6b41927a3427e10bc2ca821b',
            },
          });
        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 0);
      });
    });

    describe('getOutboundTransactionsFromBlock action', async () => {
      it('should return an array of transactions sent to the specified walletAddress', async () => {
        const senderAddress = 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV';
        let transactions =
          await adapterModule.actions.getOutboundTransactionsFromBlock.handler({
            params: {
              walletAddress: senderAddress,
              blockId:
                'bc9edb2acde2004b313c145bb12c5913fdc344a21150e843f7fab31a2041e759',
            },
          });
        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 1);

        for (let txn of transactions) {
          assert.strictEqual(typeof txn.id, 'string');
          assert.strictEqual(typeof txn.message, 'string');
          assert.strictEqual(typeof txn.amount, 'string');
          assert.strictEqual(Number.isNaN(Number(txn.amount)), false);
          assert.strictEqual(Number.isInteger(txn.timestamp), true);
          assert.strictEqual(typeof txn.senderAddress, 'string');
          assert.strictEqual(typeof txn.recipientAddress, 'string');
          assert.strictEqual(txn.senderAddress, senderAddress);
        }
      });

      it('should return transactions with a valid signatures property if transaction is from a multisig wallet', async () => {
        const multiSigWalletAddress = 'DMwCauULKf1edh4WVTYVEfZt9CouMqxDuV';
        let transactions =
          await adapterModule.actions.getOutboundTransactionsFromBlock.handler({
            params: {
              walletAddress: multiSigWalletAddress,
              blockId:
                '840db5bcc2a0fad343bc01d8173217306bd41c707ef39fabe560e5e5f39e29eb',
            },
          });
        assert(Array.isArray(transactions));
        assert.strictEqual(transactions.length, 1);
        let txn = transactions[0];

        assert.strictEqual(typeof txn.id, 'string');
        assert.strictEqual(typeof txn.message, 'string');
        assert.strictEqual(typeof txn.amount, 'string');
        assert(!Number.isNaN(Number(txn.amount)));
        assert(Number.isInteger(txn.timestamp));
        assert(Array.isArray(txn.signatures));
        for (let signature of txn.signatures) {
          assert.notStrictEqual(signature, null);
          assert.strictEqual(typeof signature.signerAddress, 'string');
        }
        assert.strictEqual(typeof txn.senderAddress, 'string');
        assert.strictEqual(typeof txn.recipientAddress, 'string');
      });

      it('should return an empty array if no transactions match the specified blockId', async () => {
        let transactions =
          await adapterModule.actions.getOutboundTransactionsFromBlock.handler({
            params: {
              walletAddress: 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzv',
              blockId:
                'd77063512b4e3e539aa8eaaf3a8646a15e94efee564e3e0c9e8f0639fee76115',
            },
          });
        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 0);
      });

      it('should return an empty array if no transactions match the specified walletAddress', async () => {
        let transactions =
          await adapterModule.actions.getOutboundTransactionsFromBlock.handler({
            params: {
              walletAddress: 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV',
              blockId:
                '748f052b313e2c84595e2e9735550b499162cbbf5ab13a065f10424f4ffa74ee',
            },
          });
        assert.strictEqual(Array.isArray(transactions), true);
        assert.strictEqual(transactions.length, 0);
      });
    });

    describe('getMaxBlockHeight action', async () => {
      it('should return the height of the block as an integer number', async () => {
        let height = await adapterModule.actions.getMaxBlockHeight.handler();
        assert(Number.isInteger(height));
      });
    });

    describe('getBlocksBetweenHeights action', async () => {
      it('should return blocks whose height is greater than fromHeight and less than or strictEqual to toHeight', async () => {
        let blocks =
          await adapterModule.actions.getBlocksBetweenHeights.handler({
            params: {
              fromHeight: 12499709,
              toHeight: 12499729,
              limit: 100,
            },
          });
        assert.strictEqual(Array.isArray(blocks), true);
        assert.strictEqual(blocks.length, 21);
        let block = blocks[0];
        assert.strictEqual(typeof block.id, 'string');
        assert.strictEqual(Number.isInteger(block.timestamp), true);
        assert.strictEqual(block.height, 12499729);
      });

      it('should return blocks whose height is greater than fromHeight and less than or strictEqual to toHeight', async () => {
        let blocks =
          await adapterModule.actions.getBlocksBetweenHeights.handler({
            params: {
              fromHeight: 14577190,
              toHeight: 14577191,
              limit: 1,
            },
          });
        assert.strictEqual(Array.isArray(blocks), true);
        assert.strictEqual(blocks.length, 0);
      });

      it('should return an empty array if no blocks are matched', async () => {
        let blocks =
          await adapterModule.actions.getBlocksBetweenHeights.handler({
            params: {
              fromHeight: 0,
              toHeight: 0,
              limit: 1,
            },
          });
        assert.strictEqual(Array.isArray(blocks), true);
        assert.strictEqual(blocks.length, 0);
      });
    });

    describe('getBlockAtHeight action', async () => {
      it('should expose a getBlockAtHeight action', async () => {
        let block = await adapterModule.actions.getBlockAtHeight.handler({
          params: {
            height: 12499729,
          },
        });
        assert.notStrictEqual(block, null);
        assert.strictEqual(block.height, 12499729);
        assert.strictEqual(Number.isInteger(block.timestamp), true);
      });

      it('should throw a BlockDidNotExistError if no block could be matched', async () => {
        let caughtError = null;
        try {
          await adapterModule.actions.getBlockAtHeight.handler({
            params: {
              height: 0,
            },
          });
        } catch (error) {
          caughtError = error;
        }
        assert.notStrictEqual(caughtError, null);
        assert.strictEqual(caughtError.type, 'InvalidActionError');
        assert.strictEqual(caughtError.name, 'BlockDidNotExistError');
      });
    });

    describe.skip('postTransaction action', async () => {
      it('should accept a prepared (signed) transaction object as argument', async () => {
        // The format of the prepared (signed) transaction will be different depending on the
        // implementation of the chain module and the specified ChainCrypto adapter.
        // Since this is used for posting multisig transactions, the transaction will have
        // a 'signatures' property containing an array of signature objects created by the DEX.
        // The format of each signature object is flexible depending on the output of the ChainCrypto
        // adapter but it will have a 'signerAddress' property.
        // The chain module can handle the transaction and signature objects however it wants.
        let preparedTxn = await client.prepareTransaction({
          type: 'transfer',
          recipientAddress: 'ldpos5f0bc55450657f7fcb188e90122f7e4cee894199',
          amount: '3300000000',
          fee: '100000000',
          timestamp: 100000,
          message: '',
        });
        await adapterModule.actions.postTransaction.handler({
          params: {
            transaction: preparedTxn,
          },
        });
      });
    });
  });

  describe('module events', async () => {
    it('should trigger bootstrap event after launch', async () => {
      assert(bootstrapEventTriggered);
    });

    it('should expose a chainChanges event', async () => {
      await wait(5000);
      assert(chainChangeEvents.length >= 1);
      let eventData = chainChangeEvents[0].data;
      assert.strictEqual(eventData.type, 'addBlock');
      let { block } = eventData;
      assert.notStrictEqual(block, null);
      assert(Number.isInteger(block.height));
      assert(Number.isInteger(block.timestamp));
    }).timeout(30000);
  });
});
