const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
      // [assignment] complete code here
      const { tornadoPool, token, omniBridge } = await loadFixture(fixture)

      const aliceKeypair = new Keypair()
      const aliceDeposit = utils.parseEther('0.1') //Alice deposits 0.1ETH
      const aliceDepositUtxo = new Utxo({ amount: aliceDeposit, keypair: aliceKeypair })
      
      const { args, extData } = await prepareTransaction({ tornadoPool, outputs: [aliceDepositUtxo], })

      const bridgeData = encodeDataForBridge({ proof: args, extData, })

      const bridgedTx = await tornadoPool.populateTransaction.onTokenBridged( token.address, aliceDepositUtxo.amount, bridgeData,)

      await token.transfer(omniBridge.address, aliceDeposit) 
      const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDeposit)

      await omniBridge.execute([{ who: token.address, callData: transferTx.data }, { who: tornadoPool.address, callData: bridgedTx.data },])

      const aliceWithdraw = utils.parseEther('0.08')
      const aliceAddress = ethers.Wallet.createRandom().address
      const aliceNewUtxo = new Utxo({ amount: aliceDeposit.sub(aliceWithdraw), keypair: aliceKeypair})
      
      await transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [aliceNewUtxo], recipient: aliceAddress, })

      const aliceBalance = await token.balanceOf(aliceAddress)
      expect(aliceBalance).to.be.equal(aliceWithdraw)
      
      const omniBridgeBalance = await token.balanceOf(omniBridge.address)
      expect(omniBridgeBalance).to.be.equal(0)
      
      const tornadoPoolBalance = await token.balanceOf(tornadoPool.address)
      expect(tornadoPoolBalance).to.be.equal(aliceDeposit.sub(aliceWithdraw))
  })

  it('[assignment] iii. see assignment doc for details', async () => {
      // [assignment] complete code here
      const { tornadoPool, token, omniBridge } = await loadFixture(fixture)

      const aliceKeypair = new Keypair()
      const aliceDeposit = utils.parseEther('0.13')
      const aliceDepositUtxo = new Utxo({ amount: aliceDeposit, keypair: aliceKeypair })
      
      const { args, extData } = await prepareTransaction({ tornadoPool, outputs: [aliceDepositUtxo], })

      const bridgeData = encodeDataForBridge({ proof: args, extData, })

      const bridgedTx = await tornadoPool.populateTransaction.onTokenBridged( token.address, aliceDepositUtxo.amount, bridgeData,)

      await token.transfer(omniBridge.address, aliceDeposit) 

      const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDeposit)

      await omniBridge.execute([{ who: token.address, callData: transferTx.data }, { who: tornadoPool.address, callData: bridgedTx.data },])
  
      const bobKeypair = new Keypair()
      const bobAddress = bobKeypair.address()

      const bobSend = utils.parseEther('0.06')
      const bobSendUtxo = new Utxo({ amount: bobSend, keypair: Keypair.fromString(bobAddress) })
      const aliceChangeUtxo = new Utxo({
        amount: aliceDeposit.sub(bobSend),
        keypair: aliceDepositUtxo.keypair,
      })

      await transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [bobSendUtxo, aliceChangeUtxo], isL1Withdrawal: false })

      const filter = tornadoPool.filters.NewCommitment()
      const fromBlock = await ethers.provider.getBlock()
      const events = await tornadoPool.queryFilter(filter, fromBlock.number)
      
      let bobReceiveUtxo
      try { bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index) }
      catch (e) { bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args.encryptedOutput, events[1].args.index) }

      expect(bobReceiveUtxo.amount).to.be.equal(bobSend)

      const bobWithdraw = bobSend
      const bobWalletAddress = ethers.Wallet.createRandom().address
      const bobChangeUtxo = new Utxo({ amount: bobSend.sub(bobWithdraw), keypair: bobKeypair })
      
      await transaction({ tornadoPool, inputs: [bobReceiveUtxo], outputs: [bobChangeUtxo], recipient: bobWalletAddress, isL1Withdrawal: false })

      const aliceWithdraw = utils.parseEther('0.07')
      const aliceWalletAddress = ethers.Wallet.createRandom().address
      const aliceChangeUtxo2 = new Utxo({ amount: aliceDeposit.sub(bobSend).sub(aliceWithdraw), keypair: aliceKeypair, })
      
      await transaction({ tornadoPool, inputs: [aliceChangeUtxo], outputs: [aliceChangeUtxo2], recipient: aliceWalletAddress, isL1Withdrawal: true })

      const bobBalance = await token.balanceOf(bobWalletAddress)
      const aliceBalance = await token.balanceOf(aliceWalletAddress)
      const omniBridgeBalance = await token.balanceOf(omniBridge.address)
      const tornadoPoolBalance = await token.balanceOf(tornadoPool.address)

      expect(bobBalance).to.be.equal(bobWithdraw)
      expect(aliceBalance).to.be.equal(utils.parseEther('0'))
      expect(omniBridgeBalance).to.be.equal(aliceWithdraw)
      expect(tornadoPoolBalance).to.be.equal(utils.parseEther('0'))
  })
})
