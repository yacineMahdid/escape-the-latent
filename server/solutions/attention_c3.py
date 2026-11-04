"""Reference solution for attention / c3 ("The Bell's Gearbox").

Paper: "Attention Is All You Need" (Vaswani et al., 2017), arXiv 1706.03762.
  * attention(): Scaled Dot-Product Attention, Section 3.2.1, Eq. (1),
    with the optional decoder mask of Section 3.2.3 (illegal connections are
    set to -inf in the input of the softmax; Figure 2: MatMul -> Scale ->
    Mask (opt.) -> SoftMax -> MatMul).
  * multi_head_attention(): MultiHead(Q, K, V) = Concat(head_1..head_h) W^O,
    head_i = Attention(Q W_i^Q, K W_i^K, V W_i^V), Section 3.2.2.

Never served to the client.
"""
import numpy as np


def attention(Q, K, V, causal=False):
    """Q: (n_q, d_k), K: (n_k, d_k), V: (n_k, d_v) -> (n_q, d_v)."""
    Q = np.asarray(Q, dtype=np.float64)
    K = np.asarray(K, dtype=np.float64)
    V = np.asarray(V, dtype=np.float64)
    d_k = Q.shape[-1]
    scores = Q @ K.T / np.sqrt(d_k)                       # (n_q, n_k)
    if causal:
        n_q, n_k = scores.shape
        future = np.triu(np.ones((n_q, n_k), dtype=bool), k=1)   # key j > query i
        scores = np.where(future, -np.inf, scores)
    scores = scores - scores.max(axis=-1, keepdims=True)  # stable softmax; the diagonal is never masked
    weights = np.exp(scores)
    weights = weights / weights.sum(axis=-1, keepdims=True)
    return weights @ V


def multi_head_attention(x_q, x_kv, W_q, W_k, W_v, W_o, h, causal=False):
    """x_q: (n_q, d_model), x_kv: (n_k, d_model); W_q, W_k: (d_model, h*d_k);
    W_v: (d_model, h*d_v); W_o: (h*d_v, d_model) -> (n_q, d_model)."""
    x_q = np.asarray(x_q, dtype=np.float64)
    x_kv = np.asarray(x_kv, dtype=np.float64)
    W_q = np.asarray(W_q, dtype=np.float64)
    W_k = np.asarray(W_k, dtype=np.float64)
    W_v = np.asarray(W_v, dtype=np.float64)
    W_o = np.asarray(W_o, dtype=np.float64)
    h = int(h)
    d_k = W_q.shape[1] // h
    d_v = W_v.shape[1] // h
    Q = x_q @ W_q      # (n_q, h*d_k)
    K = x_kv @ W_k     # (n_k, h*d_k)
    V = x_kv @ W_v     # (n_k, h*d_v)
    heads = [
        attention(Q[:, i * d_k:(i + 1) * d_k],
                  K[:, i * d_k:(i + 1) * d_k],
                  V[:, i * d_v:(i + 1) * d_v],
                  causal=causal)
        for i in range(h)
    ]
    return np.concatenate(heads, axis=1) @ W_o
