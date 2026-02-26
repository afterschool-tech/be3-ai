# Mental model: where “words” affect the pipeline

A single word can influence different stages:

- Fuzzy correction (typos)
- Statement splitting (multi-intent)
- Candidate detection (keyword/synonym matching)
- Schema resolution (scoring)
- Entity extraction & residual formation
- Query cleaning (product mention extraction)

Because these steps are layered, the same token can have different consequences depending on where you add it.
