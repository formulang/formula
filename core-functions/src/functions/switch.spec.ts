import { evalOk } from '../test-helpers/eval-formula';

describe('SWITCH', () => {
  it('matches cases and returns the corresponding value', async () => {
    expect(await evalOk('SWITCH(2; 1; "a"; 2; "b"; "d")')).toBe('b');
    expect(await evalOk('SWITCH("x"; "x"; 123; "y"; 456; 0)')).toBe(123);

    // Coercions mirror EQ semantics.
    expect(await evalOk('SWITCH("1"; 1; "ok"; "no")')).toBe('ok');
    expect(await evalOk('SWITCH("true"; TRUE; "y"; "n")')).toBe('y');

    // List vs number compares by list length.
    expect(await evalOk('SWITCH(LIST(1;2;3); 3; "len"; "no")')).toBe('len');
  });

  it('returns null when there is no match and no default', async () => {
    expect(await evalOk('SWITCH(2; 1; "a")')).toBeNull();
    expect(await evalOk('SWITCH("z"; "x"; 1; "y"; 2)')).toBeNull();
  });

  it('uses the default when provided', async () => {
    expect(await evalOk('SWITCH(3; 1; "a"; 2; "b"; "d")')).toBe('d');
  });

  it('matches null values explicitly', async () => {
    expect(await evalOk('SWITCH(INDEX(LIST(1); 0); INDEX(LIST(1); 0); "ok"; "no")')).toBe('ok');

    // Null expression can still take a default.
    expect(await evalOk('SWITCH(INDEX(LIST(1); 0); 1; "a"; "d")')).toBe('d');
  });
});
