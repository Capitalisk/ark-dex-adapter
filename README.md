# Ark DEX Adapter

DEX adapter module for the Ark blockchain.

Options:

```js
const moduleAdapter = new ArkAdapter({
  options: {
    // OPTIONAL
    alias: 'NameOfDexAdaptor', // Default: 'ark_dex_adapter'
    // OPTIONAL
    logger: console, // Default: console
    config: {
      // REQUIRED
      dexWalletAddress: 'DRFp1KVCuCMFLPFrHzbH8eYdPUoNwTXWzV',
      // OPTIONAL
      chainSymbol: 'ark', // Default: 'ark'
      // OPTIONAL
      arkAddress: 'https://dapi.ark.io/api', // Default: 'https://api.ark.io/api'
      // OPTIONAL
      // Interval to which the adapter polls the API to get new blocks
      pollingInterval: 2000, // Default: 10000
    },
  },
});
```
