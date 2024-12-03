
# commands

Try these commands
```
yarn analyze analyze obric --rpc <RPC_URL> 
yarn analyze analyze lifinity --rpc <RPC_URL> 
```


defaults to analyzing 1000 * 100 transactions, you can override using `--pages <numPages>` and `--page-size <pageSize>`.

If your RPC has tighter rate limits, try `--fetch-tx-delay <ms>` and `--fetch-acc-delay <ms>`