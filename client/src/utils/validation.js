export function isNonnegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0;
}
