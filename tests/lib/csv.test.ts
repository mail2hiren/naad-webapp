import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../src/lib/csv.ts';

test('CSV quotes cells, doubles quotes and defuses formulas', () => {
  assert.equal(toCsv(['a', 'b'], [['x, y', 'say "hi"'], [null, -3], ['=SUM(A1)', '-2']]),
    '"a","b"\r\n"x, y","say ""hi"""\r\n"","-3"\r\n"\'=SUM(A1)","\'-2"');
});
