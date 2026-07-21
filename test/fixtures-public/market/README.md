# Public market fixtures

These payloads contain no account data. CNY and USD price fixtures are synthetic;
HKD and the two compact orderbook-depth fixtures are sanitized user-supplied
responses. The orderbook fixtures retain only public item identity, currency,
top-level totals, compact price/quantity levels, and their expected wall labels.
Wallet, balance, country, session, cookie, and account fields were discarded.
The `mylistings` fixture is fully synthetic and uses non-real order IDs and URLs;
the original account response is never stored in this repository.

Order graph labels and table HTML are not treated as authoritative price fields.

Additional real, sanitized responses are still needed before broadening the
adapters to other currencies and unconfirmed endpoint fields.
