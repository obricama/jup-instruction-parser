import { AccountInfo, Connection, ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import { Command } from "commander";
import { extract } from ".";

const program = new Command();

type TargetType = {
  name: string,
  address: PublicKey,
}

const targets: Record<string, TargetType> = {
  obric: {
    name: 'Obric',
    address: new PublicKey('AvBSC1KmFNceHpD6jyyXBV6gMXFxZ8BJJ3HVUN8kCurJ'),
  },
  lifinity: {
    name: 'Lifinity v2',
    address: new PublicKey('Gkt4BpMRFxhhrrVMQsewM74ggriAbxyN2yUYDD9qt1NV'),
  },
  solfi: {
    name: 'SolFi',
    address: new PublicKey('3nQAMo837oPuGCGELcw2wo7C9hUUchsMWCneiPHFFdur'),
  }
}

export class MultipleAccountCache {
  cache: Map<string, AccountInfo<Buffer>> = new Map();
  constructor(
    public readonly connection: Connection,
    public readonly delay: number,
  ) {
  }

  async getMultipleAccountsInfo(keys: PublicKey[]) {
    const newAddrs = keys.filter(a => !this.cache.has(a.toString()));

    // load new Addrs
    if (newAddrs.length) {
      const infos = await this.connection.getMultipleAccountsInfo(newAddrs, 'processed');

      newAddrs.map((key, i) => {
        this.cache.set(key.toString(), infos[i]!);
      });

      if (this.delay) {
        await new Promise(r => setTimeout(r, this.delay))
      }
    }

    // lookup & return
    return keys.map(a => this.cache.get(a.toString())!);
  }
}

const analyzeCmd = program
  .command("analyze")
  .argument('<target>')
  .option('--rpc <rpcUrl>', '', '')
  .option('--address <address>')
  .option('--pages <numPages>', '', Number, 100)
  .option('--fetch-tx-delay <delayInMs>', '', Number, 0)
  .option('--fetch-acc-delay <delayInMs>', '', Number, 0)
  .option('--page-size <size>', '', Number, 1000)
  .action(async (targetName: string) => {
    const {rpc, pages, fetchTxDelay, fetchAccDelay, pageSize, address} = analyzeCmd.opts();
    if (!rpc) {
      throw new Error('Please specify rpc url using --rpc');
    }
    const target = targets[targetName];
    if (!target) {
      throw new Error(`${targetName} is not a valid target name`);
    }
    const connection = new Connection(rpc);
    const mac = new MultipleAccountCache(connection, fetchAccDelay) as any as Connection;

    let pureOutUsd = 0;
    let pureExactOutUsd = 0;


    const analyzeFn = async (sig: string, tx: ParsedTransactionWithMeta, idx: number) => {
      let result;
      try { result = await extract(sig, mac, tx, tx.blockTime); }
      catch(e) {}

      if (!result) return;

      const amms = (result.swapData as unknown as any[]).map(s => s.amm) as string[];
      if (!result.outAmount || !result.exactOutAmount || amms.length !== 1 || amms[0] !== target.name) {
        return;
      }
      const ratio = Number(result.outAmount) / Number(result.exactOutAmount);

      // filter out weird trades
      if (ratio > 10) {
        return;
      }

      pureOutUsd += result.outAmountInUSD;
      pureExactOutUsd += result.exactOutAmountInUSD;

    }

    const queue: ParsedTransactionWithMeta[] = [];
    let notDone = true;
    let numFetched = 0;
    const count = pages * pageSize;

    const analyzeQueue = async () => {
      let index = 0;
      while (notDone || queue.length) {
        while (queue.length === 0) {
          await new Promise(r => setTimeout(r, 100));
        }
        while (queue.length) {
          index++;
          process.stdout.write(`\rFetched ${numFetched}/${count} txs, on tx ${index}, output-over-quote ratio:  ${pureOutUsd.toFixed(0)}/${pureExactOutUsd.toFixed(0)}: ${pureOutUsd / pureExactOutUsd}`);

          const tx = queue.shift();
          // pre-filtering to run faster
          if (tx.meta.err) {
            continue;
          }
          const jupIx = tx.transaction.message.instructions.filter(ix => 
            ix.programId.toString() === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
          )[0];
          if (!jupIx) {
            continue;
          }


          await analyzeFn(tx.transaction.signatures[0], tx, index);

        }
      }
    }

    const addToQueue = (txs: ParsedTransactionWithMeta[]) => {
      txs.forEach(tx => queue.push(tx));
    }

    const queuePromise = analyzeQueue();

    let lastHash: string | undefined = undefined;

    for(let i = 0; i < pages; i++) {
      const targetAddress = address ? new PublicKey(address) : target.address;
      const hashes = await connection.getSignaturesForAddress(targetAddress, {limit: pageSize, before: lastHash})
      const parsedTxs = await connection.getParsedTransactions(hashes.map(h => h.signature), {maxSupportedTransactionVersion: 0});
      lastHash = hashes[hashes.length - 1].signature;
      numFetched += parsedTxs.length;

      addToQueue(parsedTxs);

      if (fetchTxDelay) {
        await new Promise(r => setTimeout(r, fetchTxDelay));
      }
    }

    notDone = false;
    await queuePromise;

    console.log("");
    console.log(`\rResult for target ${targetName}`);
    console.log("");
    console.log(`output-over-quote ratio:  ${pureOutUsd.toFixed(0)}/${pureExactOutUsd.toFixed(0)}: ${pureOutUsd / pureExactOutUsd}`);

  });

program.parse();