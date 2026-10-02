/**
 * Performance scoring — authoritative calculation rules (approved).
 *
 *   Final Score =
 *     (Goal Score × goalWeight) + (Competency Score × competencyWeight)
 *     on a 1.00–5.00 scale, where the composition defaults to the legacy
 *     60/40 standard and may instead be resolved per appraisal from frozen
 *     position-weight snapshots (see `resolveComponentWeights`).
 *
 *   Goal Score = Σ(goal rating × goal weight), weights as percentages (%) and
 *               required to total exactly 100%.
 *   Competency Score = average of the applicable appraisal competency ratings
 *               (competencies are equally weighted — no per-competency weights).
 *
 *   Final Performance Rating = the single approved rating band whose
 *               mathematical boundaries contain the UNROUNDED final score.
 *
 * This module is PURE and CLIENT-SAFE (no server-only import): the same
 * calculation drives the reviewer's finalize-time preview and the server's
 * official finalization, so they can never disagree.
 *
 * `self_rating` never contributes to any score. `letter_grade` is never used.
 */
import {
  performanceRatingBandFromScore,
  type PerformanceRatingBand,
} from "@/performance-development-dashboard/types";

export const SCORING_GOALS_COMPONENT_WEIGHT = 0.6;
export const SCORING_COMPETENCIES_COMPONENT_WEIGHT = 0.4;
export const SCORING_RATING_MIN = 1;
export const SCORING_RATING_MAX = 5;
export const SCORING_MIN_SCORE = 1;
export const SCORING_MAX_SCORE = 5;
export const SCORING_WEIGHTS_TOTAL = 100;
/** Floating-point tolerance for weight-total equality checks. */
export const SCORING_WEIGHT_TOLERANCE = 1e-6;

/**
 * Goals-vs-Competencies scoring composition as fractions summing to 1.
 * Defaults preserve the legacy 60/40 standard; resolved per appraisal from
 * frozen position-weight snapshots (see appraisals.ts).
 */
export type ScoringComponentWeights = {
  goalWeight: number;
  competencyWeight: number;
};

export const LEGACY_SCORING_COMPONENT_WEIGHTS: ScoringComponentWeights = {
  goalWeight: SCORING_GOALS_COMPONENT_WEIGHT,
  competencyWeight: SCORING_COMPETENCIES_COMPONENT_WEIGHT,
};

/**
 * Validates a resolved scoring composition. Returns the weights, or a
 * human-readable validation message string on failure.
 */
export function resolveComponentWeights(
  input: ScoringComponentWeights
): ScoringComponentWeights | string {
  const { goalWeight, competencyWeight } = input;
  for (const [label, value] of [
    ["goalWeight", goalWeight],
    ["competencyWeight", competencyWeight],
  ] as const) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      return `${label} must be a number between 0 and 1.`;
    }
  }
  if (
    Math.abs(goalWeight + competencyWeight - 1) > SCORING_WEIGHT_TOLERANCE
  ) {
    return "Goal and competency component weights must total exactly 1.";
  }
  return { goalWeight, competencyWeight };
}

/** A formal 1–5 integer rating (used for both goals and competencies). */
export function isScoreRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= SCORING_RATING_MIN &&
    value <= SCORING_RATING_MAX
  );
}

/**
 * Weighted KPI vs qualitative goal partition — the single shared definition
 * used by validation, scoring-input assembly, submission, finalization,
 * readiness, and UI display. Never duplicated ad hoc:
 *
 *   weighted KPI:      weight is a finite number > 0 (quantitative, scored)
 *   qualitative goal:  weight is null/undefined (developmental, unscored)
 *   invalid:           anything else (0, negative, NaN, malformed numerics)
 *
 * Invalid entries are corrupt data, never qualitative: they fail closed
 * wherever they are evaluated. NULL is never converted to 0.
 */
export function isWeightedGoalWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isQualitativeGoalWeight(value: unknown): boolean {
  return value === null || value === undefined;
}

export type WeightedGoalPartition<T> = {
  weightedGoals: T[];
  qualitativeGoals: T[];
  invalidGoals: T[];
};

export function partitionGoalsByWeight<T extends { weight: unknown }>(
  goals: T[]
): WeightedGoalPartition<T> {
  const weightedGoals: T[] = [];
  const qualitativeGoals: T[] = [];
  const invalidGoals: T[] = [];
  for (const goal of goals) {
    if (isWeightedGoalWeight(goal.weight)) weightedGoals.push(goal);
    else if (isQualitativeGoalWeight(goal.weight)) qualitativeGoals.push(goal);
    else invalidGoals.push(goal);
  }
  return { weightedGoals, qualitativeGoals, invalidGoals };
}

/** Sums WEIGHTED goal weights only — qualitative NULLs contribute nothing. */
export function sumWeightedGoalWeights(goals: { weight: unknown }[]): number {
  let total = 0;
  for (const goal of goals) {
    if (isWeightedGoalWeight(goal.weight)) total += goal.weight;
  }
  return total;
}

/** Rounds to `precision` decimals for persisted display values. */
export function roundScore(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export type GoalScoreEntry = {
  rating: number;
  weight: number;
};

/**
 * Goal Score = Σ(goal rating × goal weight), weights as percentages.
 * Returns the score, or a human-readable validation message string on failure.
 */
export function calculateGoalScore(
  entries: GoalScoreEntry[]
): number | string {
  if (entries.length === 0) {
    return "At least one applicable goal is required to calculate the goal score.";
  }

  let weightTotal = 0;
  for (const entry of entries) {
    if (!isScoreRating(entry.rating)) {
      return `Goal ratings must be whole numbers between ${SCORING_RATING_MIN} and ${SCORING_RATING_MAX}.`;
    }
    if (
      typeof entry.weight !== "number" ||
      !Number.isFinite(entry.weight) ||
      entry.weight <= 0 ||
      entry.weight > SCORING_WEIGHTS_TOTAL
    ) {
      return `Every evaluated goal needs a valid weight greater than 0 and at most ${SCORING_WEIGHTS_TOTAL} (%).`;
    }
    weightTotal += entry.weight;
  }

  if (Math.abs(weightTotal - SCORING_WEIGHTS_TOTAL) > SCORING_WEIGHT_TOLERANCE) {
    return `The evaluated goals' weights must total exactly ${SCORING_WEIGHTS_TOTAL}% (found ${roundScore(weightTotal, 2)}%).`;
  }

  return entries.reduce(
    (sum, entry) => sum + entry.rating * (entry.weight / 100),
    0
  );
}

/**
 * Competency Score = average of the applicable appraisal competency ratings
 * (equal weighting). Returns the score, or a validation message on failure.
 */
export function calculateCompetencyScore(
  ratings: number[]
): number | string {
  if (ratings.length === 0) {
    return "At least one applicable competency rating is required to calculate the competency score.";
  }
  for (const rating of ratings) {
    if (!isScoreRating(rating)) {
      return `Competency ratings must be whole numbers between ${SCORING_RATING_MIN} and ${SCORING_RATING_MAX}.`;
    }
  }
  const total = ratings.reduce((sum, rating) => sum + rating, 0);
  return total / ratings.length;
}

export type ScoreCalculation = {
  goalScore: number;
  competencyScore: number;
  finalScore: number;
  /** Persisted/displayed `final_score`, rounded to 2 decimals. */
  finalScoreDisplay: number;
  band: PerformanceRatingBand;
};

export type ScoreCalculationResult =
  | { ok: true; calculation: ScoreCalculation }
  | { ok: false; error: string };

/**
 * Computes the complete official result. The band is resolved from the
 * UNROUNDED final score (display rounding never determines a band). The
 * persisted final score is rounded for a clean numeric column value.
 * Component weights default to the legacy 60/40 standard; callers pass the
 * appraisal-resolved composition so preview, validation, and finalization
 * can never disagree.
 */
export function calculateScoring(input: {
  goalEntries: GoalScoreEntry[];
  competencyRatings: number[];
  weights?: ScoringComponentWeights;
}): ScoreCalculationResult {
  const resolvedWeights = resolveComponentWeights(
    input.weights ?? LEGACY_SCORING_COMPONENT_WEIGHTS
  );
  if (typeof resolvedWeights === "string") {
    return { ok: false, error: resolvedWeights };
  }

  const goalScore = calculateGoalScore(input.goalEntries);
  if (typeof goalScore === "string") return { ok: false, error: goalScore };

  const competencyScore = calculateCompetencyScore(input.competencyRatings);
  if (typeof competencyScore === "string") {
    return { ok: false, error: competencyScore };
  }

  const finalScore =
    goalScore * resolvedWeights.goalWeight +
    competencyScore * resolvedWeights.competencyWeight;

  // Normalize to 6 decimal places before band lookup to prevent
  // floating-point boundary misclassification (e.g. 3.499999999... → band 3).
  // Display rounding (2 decimals) remains separate.
  const normalizedFinalScore = Math.round(finalScore * 1_000_000) / 1_000_000;

  const band = performanceRatingBandFromScore(normalizedFinalScore);
  if (
    !band ||
    normalizedFinalScore < SCORING_MIN_SCORE ||
    normalizedFinalScore > SCORING_MAX_SCORE
  ) {
    return {
      ok: false,
      error: `The computed final score (${roundScore(finalScore, 2)}) does not fall within the approved 1–5 range.`,
    };
  }

  return {
    ok: true,
    calculation: {
      goalScore,
      competencyScore,
      finalScore,
      finalScoreDisplay: roundScore(finalScore),
      band,
    },
  };
}