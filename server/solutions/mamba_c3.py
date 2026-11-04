"""Reference solution for mamba / c3 ("The Belly Scanner").

Paper: "Mamba: Linear-Time Sequence Modeling with Selective State Spaces" (Gu, Dao, 2023), arXiv 2312.00752.
  * selective_scan(): the SSM recurrence (2a)/(2b), h_t = A_bar h_{t-1} + B_bar x_t, y_t = C h_t,
    made time-varying as in Algorithm 2 (S6): Delta, B, C carry a length dimension L.
    Discretization is the zero-order hold of Eq. (4): A_bar = exp(Delta A),
    B_bar = (Delta A)^{-1} (exp(Delta A) - I) . Delta B, which for a diagonal A is elementwise
    B_bar = (exp(Delta A) - 1) / A * B.
    Each of the D channels runs its own SSM with an N-dimensional state (Section 2, "Structure and
    Dimensions"); B_t and C_t (shape N) are shared by all channels, Delta_t has one value per channel.
    h0 / h_last let a long sequence be scanned chunk by chunk (Appendix D).
  * s6(): the selection mechanism of Section 3.2 / Algorithm 2:
    B = s_B(x) = Linear_N(x), C = s_C(x) = Linear_N(x),
    Delta = tau_Delta(Parameter + s_Delta(x)) with s_Delta(x) = Broadcast_D(Linear_1(x)), tau_Delta = softplus.

Never served to the client.
"""
import numpy as np


def selective_scan(x, delta, A, B, C, h0=None):
    """x: (L, D), delta: (L, D) > 0, A: (D, N) < 0, B: (L, N), C: (L, N), h0: (D, N) or None.

    Returns (y, h_last): y (L, D), h_last (D, N).
    """
    x = np.asarray(x, dtype=np.float64)
    delta = np.asarray(delta, dtype=np.float64)
    A = np.asarray(A, dtype=np.float64)
    B = np.asarray(B, dtype=np.float64)
    C = np.asarray(C, dtype=np.float64)
    L, D = x.shape
    N = A.shape[1]
    h = np.zeros((D, N)) if h0 is None else np.array(h0, dtype=np.float64)
    y = np.zeros((L, D))
    for t in range(L):
        dA = delta[t][:, None] * A                  # (D, N)
        A_bar = np.exp(dA)                          # ZOH, Eq. (4)
        B_bar = np.expm1(dA) / A * B[t][None, :]    # (dA)^-1 (exp(dA) - 1) * delta * B, elementwise
        h = A_bar * h + B_bar * x[t][:, None]       # (2a), one N-dim state per channel
        y[t] = h @ C[t]                             # (2b): y_t[d] = sum_n C_t[n] h_t[d, n]
    return y, h


def softplus(z):
    return np.logaddexp(0.0, z)


def s6(x, A, W_B, W_C, w_delta, delta_bias):
    """x: (L, D), A: (D, N), W_B: (D, N), W_C: (D, N), w_delta: (D,), delta_bias: (D,) -> y (L, D)."""
    x = np.asarray(x, dtype=np.float64)
    W_B = np.asarray(W_B, dtype=np.float64)
    W_C = np.asarray(W_C, dtype=np.float64)
    w_delta = np.asarray(w_delta, dtype=np.float64)
    delta_bias = np.asarray(delta_bias, dtype=np.float64)
    B = x @ W_B                                              # s_B(x) = Linear_N(x): (L, N)
    C = x @ W_C                                              # s_C(x) = Linear_N(x): (L, N)
    delta = softplus(delta_bias[None, :] + (x @ w_delta)[:, None])   # tau(Parameter + Broadcast_D(Linear_1(x))): (L, D)
    y, _ = selective_scan(x, delta, A, B, C)
    return y
