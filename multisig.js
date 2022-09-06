const { Connection } = require('@arkecosystem/client');
const { Identities, Transactions } = require('@arkecosystem/crypto');
const { generateMnemonic } = require('bip39');

const client = new Connection('https://dapi.ark.io/api');

const WALLET_ADDRESS = 'DRzgcj97d3hFdLJjYhPTdBQNVeb92mzrx5';

(async () => {
  // TEST BALANCE
  const {
    body: { data },
  } = await client.api('wallets').get(WALLET_ADDRESS);

  console.log(data);

  // CREATE MULTISIG WALLET
  // SEE https://github.com/ArkEcosystem/core/blob/22dffb49df51e9d200bce89503e9ed22f291a6cf/__tests__/functional/transaction-forging/entity-register.test.ts#L127
  const passphrases = [
    WALLET_ADDRESS,
    generateMnemonic(),
    generateMnemonic(),
    generateMnemonic(),
    generateMnemonic(),
  ];

  let participants = [];

  passphrases.forEach((p) =>
    participants.push(Identities.PublicKey.fromPassphrase(p)),
  );

  const transaction = await Transactions.BuilderFactory.multiSignature()
    .min(4)
    .amount(1000)
    .participant(participants);

  const serialized =
    Transactions.Serializer.serialize(transaction).toString('hex');

  console.log(serialized);

  // const initialFunds = Transactions.TransactionFactory.initialize(app)
  //   .transfer(Identities.Address.fromPassphrase(passphrase), 1 * 1e8)
  //   .withPassphrase(secrets[0])
  //   .createOne();

  // await expect(initialFunds).toBeAccepted();
  // await snoozeForBlock(1);
  // await expect(initialFunds.id).toBeForged();

  // // Registering a multi-signature wallet
  // const multiSignature = TransactionFactory.initialize(app)
  //   .multiSignature(participants, 3)
  //   .withPassphrase(passphrase)
  //   .withPassphraseList(passphrases)
  //   .createOne();

  // await expect(multiSignature).toBeAccepted();
  // await snoozeForBlock(1);
  // await expect(multiSignature.id).toBeForged();

  // // Send funds to multi signature wallet
  // const multiSigAddress = Identities.Address.fromMultiSignatureAsset(
  //   multiSignature.asset.multiSignature,
  // );
  // const multiSigPublicKey = Identities.PublicKey.fromMultiSignatureAsset(
  //   multiSignature.asset.multiSignature,
  // );

  // const multiSignatureFunds = TransactionFactory.initialize(app)
  //   .transfer(multiSigAddress, 100 * 1e8)
  //   .withPassphrase(secrets[0])
  //   .createOne();

  // await expect(multiSignatureFunds).toBeAccepted();
  // await snoozeForBlock(1);
  // await expect(multiSignatureFunds.id).toBeForged();

  // // Registering entity
  // const entityRegistration = TransactionFactory.initialize(app)
  //   .entity({
  //     type: Enums.EntityType.Module,
  //     subType: 0,
  //     action: Enums.EntityAction.Register,
  //     data: {
  //       name: 'iam_a_module',
  //     },
  //   })
  //   .withSenderPublicKey(multiSigPublicKey)
  //   .withPassphraseList(passphrases)
  //   .createOne();

  // await expect(entityRegistration).toBeAccepted();
  // await snoozeForBlock(1);
  // await expect(entityRegistration.id).toBeForged();
  // await expect(entityRegistration).entityRegistered();
})();
