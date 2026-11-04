"""Reference solution for clip / c3 ("The Two Gears").

Paper: "Learning Transferable Visual Models From Natural Language Supervision"
(Radford et al., 2021), arXiv 2103.00020.
  * clip_loss(): the core of CLIP pre-training, exactly Figure 3:
      I_e = l2_normalize(I_f @ W_i), T_e = l2_normalize(T_f @ W_t)
      logits = I_e @ T_e.T * exp(t)            (scaled pairwise cosine similarities)
      labels = arange(n)                       (the true pairs are the diagonal)
      loss = (CE over axis 0 + CE over axis 1) / 2   (symmetric cross-entropy)
    t is the log-parameterized learned temperature (Section 2.3); the logits are
    never scaled by more than 100 (Section 2.5, Table 18 "Maximum temperature 100.0").
  * zero_shot(): zero-shot classification (Section 3.1.2): cosine similarity
    between the image and each class's text embedding, scaled, softmax over
    classes. Prompt ensembles are built in embedding space (Section 3.1.4): one
    cached, averaged text embedding per class (each prompt embedding is
    L2-normalised before averaging, and the class mean is L2-normalised again
    so the score is a true cosine).

Never served to the client.
"""
import numpy as np

MAX_LOGIT_SCALE = 100.0


def _l2_normalize(x):
    return x / np.linalg.norm(x, axis=-1, keepdims=True)


def _logsumexp(a, axis):
    m = np.max(a, axis=axis, keepdims=True)
    return np.squeeze(m, axis=axis) + np.log(np.sum(np.exp(a - m), axis=axis))


def clip_loss(I_f, T_f, W_i, W_t, t):
    """I_f: (n, d_i), T_f: (n, d_t), W_i: (d_i, d_e), W_t: (d_t, d_e), t: float -> float."""
    I_f = np.asarray(I_f, dtype=np.float64)
    T_f = np.asarray(T_f, dtype=np.float64)
    W_i = np.asarray(W_i, dtype=np.float64)
    W_t = np.asarray(W_t, dtype=np.float64)
    I_e = _l2_normalize(I_f @ W_i)                      # (n, d_e)
    T_e = _l2_normalize(T_f @ W_t)                      # (n, d_e)
    scale = np.exp(min(float(t), np.log(MAX_LOGIT_SCALE)))
    logits = (I_e @ T_e.T) * scale                      # (n, n), row = image, column = text
    true = np.diagonal(logits)                          # labels = arange(n)
    loss_i = np.mean(_logsumexp(logits, axis=0) - true)  # each text picks among the images
    loss_t = np.mean(_logsumexp(logits, axis=1) - true)  # each image picks among the texts
    return float((loss_i + loss_t) / 2.0)


def zero_shot(image_emb, prompt_emb, scale=100.0):
    """image_emb: (m, d), prompt_emb: (C, K, d) -> (m, C) class probabilities."""
    X = _l2_normalize(np.asarray(image_emb, dtype=np.float64))    # (m, d)
    P = _l2_normalize(np.asarray(prompt_emb, dtype=np.float64))   # (C, K, d)
    W = _l2_normalize(P.mean(axis=1))                             # (C, d): one lantern per class
    logits = float(scale) * (X @ W.T)                             # (m, C)
    logits = logits - logits.max(axis=1, keepdims=True)
    e = np.exp(logits)
    return e / e.sum(axis=1, keepdims=True)
