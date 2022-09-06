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

  let walletMembers =
    await adapterModule.actions.getMultisigWalletMembers.handler({
      params: {
        walletAddress: WALLET_ADDRESS,
      },
    });

  const memberAddessList = [
    'DMwCauULKf1edh4WVTYVEfZt9CouMqxDuV',
    'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV',
    'DRzgcj97d3hFdLJjYhPTdBQNVeb92mzrx5',
  ];

  console.log(walletMembers);
})();
