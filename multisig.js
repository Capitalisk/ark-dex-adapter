const { Connection } = require('@arkecosystem/client');
const { Identities, Transactions } = require('@arkecosystem/crypto');
const { generateMnemonic } = require('bip39');
const ArkDEXAdapter = require('./index.js');

const WALLET_ADDRESS = 'DMwCauULKf1edh4WVTYVEfZt9CouMqxDuV';

(async () => {
  const adapterModule = new ArkDEXAdapter({
    config: {
      env: 'test',
      dexWalletAddress: WALLET_ADDRESS,
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

  // // TEST BALANCE
  // const {
  //   body: { data },
  // } = await client.api('wallets').get(WALLET_ADDRESS);

  // console.log(data);

  // let walletMembers =
  //   await adapterModule.actions.getMultisigWalletMembers.handler({
  //     params: {
  //       walletAddress: WALLET_ADDRESS,
  //     },
  //   });

  // const memberAddessList = [
  //   'DMwCauULKf1edh4WVTYVEfZt9CouMqxDuV',
  //   'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV',
  //   'DRzgcj97d3hFdLJjYhPTdBQNVeb92mzrx5',
  // ];

  // console.log(walletMembers);

  // let caughtError = null;
  // try {
  //   await adapterModule.actions.getMultisigWalletMembers.handler({
  //     params: {
  //       walletAddress: 'ldpos6312b77c6ca4233141835eb37f8f33a45f18d50f',
  //     },
  //   });
  // } catch (error) {
  //   caughtError = error;
  // }
  // console.log(caughtError.type, caughtError.name, caughtError);

  // const count = await adapterModule.actions.getMinMultisigRequiredSignatures.handler({
  //   params: {
  //     walletAddress: WALLET_ADDRESS,
  //   },
  // });

  // console.log(count)

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
  console.log(caughtError.type, caughtError.name, caughtError);
  // assert.notStrictEqual(caughtError, null);
  // assert.strictEqual(caughtError.type, 'InvalidActionError');
  // assert.strictEqual(caughtError.name, 'AccountWasNotMultisigError');
})();