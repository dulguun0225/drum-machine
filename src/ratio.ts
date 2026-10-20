// Rational numbers for step durations, measured in quarter-note beats.

export interface Ratio {
  num: number;
  den: number;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

export function reduce(num: number, den: number): Ratio {
  const g = gcd(num, den) || 1;
  return { num: num / g, den: den / g };
}

/** Least common multiple of two reduced fractions: lcm(a, c) / gcd(b, d). */
export function lcmRatio(x: Ratio, y: Ratio): Ratio {
  return reduce(lcm(x.num, y.num), gcd(x.den, y.den));
}

export function ratioValue(r: Ratio): number {
  return r.num / r.den;
}

export function sameRatio(x: Ratio, y: Ratio): boolean {
  return x.num * y.den === y.num * x.den;
}
