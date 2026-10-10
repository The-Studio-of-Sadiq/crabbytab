export interface MotionBalanceAnalysis {
  observations: number;
  expectedPerPosition: number;
  chiSquared: number | null;
  degreesOfFreedom: number;
  pValue: number | null;
  lowExpectedCount: boolean;
}

function complementaryErrorFunction(value: number): number {
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.5 * absolute);
  const approximation = t * Math.exp(
    -absolute * absolute -
      1.26551223 +
      t * (1.00002368 +
        t * (0.37409196 +
          t * (0.09678418 +
            t * (-0.18628806 +
              t * (0.27886807 +
                t * (-1.13520398 +
                  t * (1.48851587 +
                    t * (-0.82215223 + t * 0.17087277))))))))
  );
  return value >= 0 ? approximation : 2 - approximation;
}

export function analyzeMotionBalance(positionWins: number[]): MotionBalanceAnalysis {
  const observations = positionWins.reduce((total, wins) => total + wins, 0);
  const degreesOfFreedom = Math.max(0, positionWins.length - 1);
  const expectedPerPosition = positionWins.length > 0 ? observations / positionWins.length : 0;
  if (observations === 0 || positionWins.length < 2) {
    return {
      observations,
      expectedPerPosition,
      chiSquared: null,
      degreesOfFreedom,
      pValue: null,
      lowExpectedCount: expectedPerPosition < 5,
    };
  }

  const chiSquared = positionWins.reduce(
    (total, wins) => total + ((wins - expectedPerPosition) ** 2) / expectedPerPosition,
    0
  );
  const z = Math.sqrt(chiSquared / 2);
  const pValue = positionWins.length === 2
    ? complementaryErrorFunction(z)
    : positionWins.length === 4
      ? complementaryErrorFunction(z) + Math.sqrt((2 * chiSquared) / Math.PI) * Math.exp(-chiSquared / 2)
      : null;

  return {
    observations,
    expectedPerPosition,
    chiSquared,
    degreesOfFreedom,
    pValue: pValue === null ? null : Math.max(0, Math.min(1, pValue)),
    lowExpectedCount: expectedPerPosition < 5,
  };
}
