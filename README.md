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

## Actions

### getMultisigWalletMembers({ walletAddress })

Method: GET
- Endpoint: https://api.ark.io/api/wallets/${walletAddress}
- Example: https://api.ark.io/api/wallets/AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX

### getMinMultisigRequiredSignatures({ walletAddress })

Method: GET
- Endpoint: https://api.ark.io/api/wallets/${walletAddress}
- Example: https://api.ark.io/api/wallets/AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX

### getOutboundTransactions({ walletAddress, fromTimestamp, limit })

Method: GET
- Endpoint: https://api.ark.io/api/transactions?page=1&senderId=${walletAddress}&timestamp.from=${fromEpochTimestamp+1}&limit=${limit}
- Example: https://api.ark.io/api/transactions?page=1&senderId=AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX&timestamp.from=121676312&limit=100

Notes:

- The Unix fromTimestamp will need to be converted to Ark's native timestamp format fromEpochTimestamp
- Use timestamp.to parameter for fetching the data in the reverse order - In that case, fromEpochTimestamp would need to be -1.

### getInboundTransactionsFromBlock({ walletAddress, blockId })

Method: GET
- Endpoint: https://api.ark.io/api/transactions?page=1&recipientId=${walletAddress}&blockId=${blockId}
- Example: https://api.ark.io/api/transactions?page=1&recipientId=AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX&blockId=428298302dd08c34c59ce46f55c0fffecc1e2ffa30ec194fe9a99d2b4efe8e4f

### getOutboundTransactionsFromBlock({ walletAddress, blockId })

Method: GET
- Endpoint: https://api.ark.io/api/transactions?page=1&senderId=${walletAddress}&blockId=${blockId}
- Example: https://api.ark.io/api/transactions?page=1&senderId=AXzxJ8Ts3dQ2bvBR1tPE7GUee9iSEJb8HX&blockId=d77063512b4e3e539aa8eaaf3a8646a15e94efee564e3e0c9e8f0639fee76115

### getLastBlockAtTimestamp({ timestamp })

Method: GET
- Endpoint: https://api.ark.io/api/blocks?page=1&limit=1&timestamp.to=${timestamp}
- Example: https://api.ark.io/api/blocks?page=1&limit=1&timestamp.to=171673424

### getMaxBlockHeight()

Method: GET
- Endpoint: https://api.ark.io/api/blockchain
- Example: https://api.ark.io/api/blockchain

### getBlocksBetweenHeights({ fromHeight, toHeight, limit })

Method: GET
- Endpoint: https://api.ark.io/api/blocks?page=1&height.from=${fromHeight+1}&height.to=${toHeight}&limit=${limit}
- Example: https://api.ark.io/api/blocks?page=1&height.from=21300790&height.to=21300791&limit=100

### getBlockAtHeight({ height })

Method: GET
- Endpoint: https://api.ark.io/api/blocks?page=1&limit=1&height=${height}
- Example: https://api.ark.io/api/blocks?page=1&limit=1&height=21300899

### postTransaction

Method: POST
- Endpoint: https://api.ark.io/api/transactions
- Example: https://api.ark.io/api/transactions

---

## Events

### bootstrap

### chainChanges
