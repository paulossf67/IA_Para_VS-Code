import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from './retry';

describe('retryWithBackoff', () => {
  it('retorna sucesso na primeira tentativa', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await retryWithBackoff(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retenta após erro e sucede', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, 3, 10);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('lança erro após esgotar retentativas', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent fail'));
    const testError = async () => await retryWithBackoff(fn, 2, 10);

    await expect(testError()).rejects.toThrow('persistent fail');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('aplica backoff exponencial com jitter', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValueOnce('success');

    const promise = retryWithBackoff(fn, 3, 100);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe('success');
    vi.useRealTimers();
  });
});
