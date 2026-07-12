# Public market fixtures

These payloads contain no account data. CNY and USD are synthetic; HKD is a
sanitized user-supplied `priceoverview` response. They model only the Steam
response fields consumed by the v2.1 adapters. In particular, order graph labels
and table HTML are not treated as authoritative price fields.

Additional real, sanitized responses are still needed before broadening the
adapters to other currencies and unconfirmed endpoint fields.
