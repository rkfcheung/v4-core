import { Decimal } from 'decimal.js'
import { BigNumber, BigNumberish, ContractTransaction } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { MockTimeUniswapV3Pair } from '../typechain/MockTimeUniswapV3Pair'
import { TestERC20 } from '../typechain/TestERC20'
import { expect } from './shared/expect'
import { pairFixture } from './shared/fixtures'

import {
  createPairFunctions,
  encodePriceSqrt,
  expandTo18Decimals,
  FeeAmount,
  getMaxTick,
  getMinTick,
  TICK_SPACINGS,
} from './shared/utilities'
import { TestUniswapV3Callee } from '../typechain/TestUniswapV3Callee'

const createFixtureLoader = waffle.createFixtureLoader
const { constants } = ethers

interface BaseSwapTestCase {
  zeroForOne: boolean
  sqrtPriceLimit?: BigNumber
}
interface SwapExact0For1TestCase extends BaseSwapTestCase {
  zeroForOne: true
  exactOut: false
  amount0: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface SwapExact1For0TestCase extends BaseSwapTestCase {
  zeroForOne: false
  exactOut: false
  amount1: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface Swap0ForExact1TestCase extends BaseSwapTestCase {
  zeroForOne: true
  exactOut: true
  amount1: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface Swap1ForExact0TestCase extends BaseSwapTestCase {
  zeroForOne: false
  exactOut: true
  amount0: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface SwapToHigherPrice extends BaseSwapTestCase {
  zeroForOne: false
  sqrtPriceLimit: BigNumber
}
interface SwapToLowerPrice extends BaseSwapTestCase {
  zeroForOne: true
  sqrtPriceLimit: BigNumber
}
type SwapTestCase =
  | SwapExact0For1TestCase
  | Swap0ForExact1TestCase
  | SwapExact1For0TestCase
  | Swap1ForExact0TestCase
  | SwapToHigherPrice
  | SwapToLowerPrice

function formatTokenAmount(num: BigNumberish): string {
  return new Decimal(num.toString()).dividedBy(new Decimal(10).pow(18)).toPrecision(5)
}

function formatPrice(price: BigNumberish): string {
  return new Decimal(price.toString()).dividedBy(new Decimal(2).pow(96)).pow(2).toPrecision(5)
}

function swapCaseToDescription(testCase: SwapTestCase): string {
  const priceClause = testCase?.sqrtPriceLimit ? ` to price ${formatPrice(testCase.sqrtPriceLimit)}` : ''
  if ('exactOut' in testCase) {
    if (testCase.exactOut) {
      if (testCase.zeroForOne) {
        return `swap token0 for exactly ${formatTokenAmount(testCase.amount1)} token1${priceClause}`
      } else {
        return `swap token1 for exactly ${formatTokenAmount(testCase.amount0)} token0${priceClause}`
      }
    } else {
      if (testCase.zeroForOne) {
        return `swap exactly ${formatTokenAmount(testCase.amount0)} token0 for token1${priceClause}`
      } else {
        return `swap exactly ${formatTokenAmount(testCase.amount1)} token1 for token0${priceClause}`
      }
    }
  } else {
    if (testCase.zeroForOne) {
      return `swap token0 for token1${priceClause}`
    } else {
      return `swap token1 for token0${priceClause}`
    }
  }
}

type PairFunctions = ReturnType<typeof createPairFunctions>

// can't use address zero because the ERC20 token does not allow it
const RECIPIENT_ADDRESS = constants.AddressZero.slice(0, -1) + '1'

async function executeSwap(
  pair: MockTimeUniswapV3Pair,
  testCase: SwapTestCase,
  pairFunctions: PairFunctions
): Promise<ContractTransaction> {
  let swap: ContractTransaction
  if ('exactOut' in testCase) {
    if (testCase.exactOut) {
      if (testCase.zeroForOne) {
        swap = await pairFunctions.swap0ForExact1(testCase.amount1, RECIPIENT_ADDRESS)
      } else {
        swap = await pairFunctions.swap1ForExact0(testCase.amount0, RECIPIENT_ADDRESS)
      }
    } else {
      if (testCase.zeroForOne) {
        swap = await pairFunctions.swapExact0For1(testCase.amount0, RECIPIENT_ADDRESS)
      } else {
        swap = await pairFunctions.swapExact1For0(testCase.amount1, RECIPIENT_ADDRESS)
      }
    }
  } else {
    if (testCase.zeroForOne) {
      swap = await pairFunctions.swapToLowerPrice(testCase.sqrtPriceLimit, RECIPIENT_ADDRESS)
    } else {
      swap = await pairFunctions.swapToHigherPrice(testCase.sqrtPriceLimit, RECIPIENT_ADDRESS)
    }
  }
  return swap
}

const DEFAULT_PAIR_SWAP_TESTS: SwapTestCase[] = [
  {
    zeroForOne: true,
    exactOut: false,
    amount0: expandTo18Decimals(1),
  },
  {
    zeroForOne: false,
    exactOut: false,
    amount1: expandTo18Decimals(1),
  },
  {
    zeroForOne: true,
    exactOut: true,
    amount1: expandTo18Decimals(1),
  },
  {
    zeroForOne: true,
    exactOut: true,
    amount1: expandTo18Decimals(1),
  },
  {
    sqrtPriceLimit: encodePriceSqrt(5, 2),
    zeroForOne: false,
  },
  {
    sqrtPriceLimit: encodePriceSqrt(2, 5),
    zeroForOne: true,
  },
  {
    sqrtPriceLimit: encodePriceSqrt(5, 2),
    zeroForOne: true,
  },
  {
    sqrtPriceLimit: encodePriceSqrt(2, 5),
    zeroForOne: false,
  },
]

interface Position {
  tickLower: number
  tickUpper: number
  liquidity: BigNumberish
}

interface PairTestCase {
  description: string
  feeAmount: number
  tickSpacing: number
  startingPrice: BigNumber
  positions: Position[]
  swapTests?: SwapTestCase[]
}

const TEST_PAIRS: PairTestCase[] = [
  {
    description: 'low fee, 1:1 price, 2e18 max range liquidity',
    feeAmount: FeeAmount.LOW,
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    startingPrice: encodePriceSqrt(1, 1),
    positions: [
      {
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.LOW]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.LOW]),
        liquidity: expandTo18Decimals(2),
      },
    ],
  },
  {
    description: 'medium fee, 1:1 price, 2e18 max range liquidity',
    feeAmount: FeeAmount.MEDIUM,
    tickSpacing: TICK_SPACINGS[FeeAmount.MEDIUM],
    startingPrice: encodePriceSqrt(1, 1),
    positions: [
      {
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        liquidity: expandTo18Decimals(2),
      },
    ],
  },
  {
    description: 'high fee, 1:1 price, 2e18 max range liquidity',
    feeAmount: FeeAmount.HIGH,
    tickSpacing: TICK_SPACINGS[FeeAmount.HIGH],
    startingPrice: encodePriceSqrt(1, 1),
    positions: [
      {
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.HIGH]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.HIGH]),
        liquidity: expandTo18Decimals(2),
      },
    ],
  },
  {
    description: 'medium fee, 10:1 price, 2e18 max range liquidity',
    feeAmount: FeeAmount.MEDIUM,
    tickSpacing: TICK_SPACINGS[FeeAmount.MEDIUM],
    startingPrice: encodePriceSqrt(10, 1),
    positions: [
      {
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.HIGH]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.HIGH]),
        liquidity: expandTo18Decimals(2),
      },
    ],
  },
  {
    description: 'medium fee, 1:10 price, 2e18 max range liquidity',
    feeAmount: FeeAmount.MEDIUM,
    tickSpacing: TICK_SPACINGS[FeeAmount.MEDIUM],
    startingPrice: encodePriceSqrt(1, 10),
    positions: [
      {
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.HIGH]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.HIGH]),
        liquidity: expandTo18Decimals(2),
      },
    ],
  },
]

describe('UniswapV3Pair swap tests', () => {
  const [wallet, other] = waffle.provider.getWallets()

  let loadFixture: ReturnType<typeof createFixtureLoader>

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader([wallet])
  })

  for (const pairCase of TEST_PAIRS) {
    describe(pairCase.description, () => {
      const pairCaseFixture = async () => {
        const { createPair, token0, token1, swapTarget } = await pairFixture([wallet], waffle.provider)
        const pair = await createPair(pairCase.feeAmount, pairCase.tickSpacing)
        const pairFunctions = createPairFunctions({ token0, token1, pair, swapTarget })
        await pair.initialize(pairCase.startingPrice)
        // mint all positions
        for (const position of pairCase.positions) {
          await pairFunctions.mint(constants.AddressZero, position.tickLower, position.tickUpper, position.liquidity)
        }

        const [pairBalance0, pairBalance1] = await Promise.all([
          token0.balanceOf(pair.address),
          token1.balanceOf(pair.address),
        ])

        return { token0, token1, pair, pairFunctions, pairBalance0, pairBalance1, swapTarget }
      }

      let token0: TestERC20
      let token1: TestERC20

      let pairBalance0: BigNumber
      let pairBalance1: BigNumber

      let pair: MockTimeUniswapV3Pair
      let swapTarget: TestUniswapV3Callee
      let pairFunctions: PairFunctions

      beforeEach('load fixture', async () => {
        ;({ token0, token1, pair, pairFunctions, pairBalance0, pairBalance1, swapTarget } = await loadFixture(
          pairCaseFixture
        ))
      })

      for (const testCase of pairCase.swapTests ?? DEFAULT_PAIR_SWAP_TESTS) {
        it(swapCaseToDescription(testCase), async () => {
          const slot0 = await pair.slot0()
          const tx = executeSwap(pair, testCase, pairFunctions)
          try {
            await tx
          } catch (error) {
            expect(error.message).to.matchSnapshot('swap error')
            return
          }
          const [pairBalance0After, pairBalance1After, slot0After] = await Promise.all([
            token0.balanceOf(pair.address),
            token1.balanceOf(pair.address),
            pair.slot0(),
          ])
          const pairBalance0Delta = pairBalance0After.sub(pairBalance0)
          const pairBalance1Delta = pairBalance1After.sub(pairBalance1)

          // check all the events were emitted corresponding to balance changes
          if (pairBalance0Delta.eq(0)) await expect(tx).to.not.emit(token0, 'Transfer')
          else if (pairBalance0Delta.lt(0))
            await expect(tx)
              .to.emit(token0, 'Transfer')
              .withArgs(pair.address, RECIPIENT_ADDRESS, pairBalance0Delta.mul(-1))
          else await expect(tx).to.emit(token0, 'Transfer').withArgs(wallet.address, pair.address, pairBalance0Delta)

          if (pairBalance1Delta.eq(0)) await expect(tx).to.not.emit(token1, 'Transfer')
          else if (pairBalance1Delta.lt(0))
            await expect(tx)
              .to.emit(token1, 'Transfer')
              .withArgs(pair.address, RECIPIENT_ADDRESS, pairBalance1Delta.mul(-1))
          else await expect(tx).to.emit(token1, 'Transfer').withArgs(wallet.address, pair.address, pairBalance1Delta)

          // check that the swap event was emitted too
          await expect(tx)
            .to.emit(pair, 'Swap')
            .withArgs(
              swapTarget.address,
              RECIPIENT_ADDRESS,
              pairBalance0Delta,
              pairBalance1Delta,
              slot0After.sqrtPriceX96,
              slot0After.tick
            )

          expect({
            amount0Delta: pairBalance0Delta.toString(),
            amount1Delta: pairBalance1Delta.toString(),
            tickBefore: slot0.tick,
            pairPriceBefore: formatPrice(slot0.sqrtPriceX96),
            tickAfter: slot0After.tick,
            pairPriceAfter: formatPrice(slot0After.sqrtPriceX96),
            executionPrice: new Decimal(pairBalance1Delta.toString())
              .div(pairBalance0Delta.toString())
              .mul(-1)
              .toPrecision(5),
          }).to.matchSnapshot('balances')
        })
      }
    })
  }
})