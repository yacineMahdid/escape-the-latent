import numpy as np


def softmax(x):
    """Row-wise softmax of a 2-D array x with shape (n, m), stable for large values."""
    x = np.asarray(x, dtype=float)
    shifted = x - x.max(axis=1, keepdims=True)
    e = np.exp(shifted)
    return e / e.sum(axis=1, keepdims=True)
