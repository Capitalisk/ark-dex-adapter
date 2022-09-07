const { computeDEXTransactionId } = require('../common/utils');

const transactionMapper = (t) => {
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
  return {
    id: computeDEXTransactionId(t.sender, t.nonce),
    message: t.vendorField || '',
    amount: t.amount,
    timestamp: t.timestamp.unix,
    senderAddress: t.sender,
    recipientAddress: t.recipient,
    signatures: t.signatures,
    nonce: t.nonce,
  };
};

const blockMapper = ({ id, height, timestamp, numberOfTransactions }) => ({
  id,
  height,
  timestamp,
  numberOfTransactions,
});

module.exports = { transactionMapper, blockMapper };
