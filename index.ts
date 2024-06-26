import { promises as fs } from "fs";
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { init, RuntimeMetadata } from 'merkleized-metadata';

import { objectSpread } from '@polkadot/util';
import type { SignerPayloadJSON } from '@polkadot/types/types/extrinsic.js';
import type { u16 } from '@polkadot/types';

const WS_URL = 'wss://kusama-rpc.polkadot.io';
const DEV_WS_URL = 'ws://127.0.0.1:9944';
// Set for Kusama
const DECIMALS = 12;
const TOKEN_SYMBOL = 'KSM';


const createKeyPair = async (ss58Format: number) => {
    const keyPhrase = await fs.readFile('keyphrase.txt', 'utf-8')
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
    const keyring = new Keyring({ type: 'sr25519', ss58Format });

    return keyring.addFromUri(keyPhrase, { name: 'keyPair' });
}

const createDevKeyPair = (ss58Format: number) => {
    const keyring = new Keyring({ type: 'sr25519', ss58Format });
    return keyring.addFromUri('//Alice', { name: 'Alice' }, 'sr25519');
}

const signer = {
    signPayload: async (payload: SignerPayloadJSON) => {
        // Initialize Wasm methods
        const mm = await init();
        // When active it will use a alice keypair
        const isDev = process.argv[2] === '--dev';
    
        const api = await ApiPromise.create({
            provider: new WsProvider(isDev ? DEV_WS_URL : WS_URL)
        });

        await api.isReady;


        const ss58 = (api.consts.system.ss58Prefix as u16).toNumber();
        const keyPair = isDev ? createDevKeyPair(ss58) : await createKeyPair(ss58);
        
        const metadata = await api.call.metadata.metadataAtVersion(15);
        const { specName, specVersion } = await api.rpc.state.getRuntimeVersion();
        const runtimeMetadata = RuntimeMetadata.fromHex(metadata.toHex());
        const digest = mm.generateMetadataDigest(runtimeMetadata, {
            base58Prefix: (api.consts.system.ss58Prefix as u16).toNumber(),
            decimals: DECIMALS,
            specName: specName.toString(),
            specVersion: specVersion.toNumber(),
            tokenSymbol: TOKEN_SYMBOL
        });

        const newPayload = objectSpread({}, payload, { mode: 1, metadataHash: '0x' + digest.hash() });     
        const signerPayload = api.registry.createType('ExtrinsicPayload', newPayload);
        const { signature } = signerPayload.sign(keyPair);
        const extrinsic = api.registry.createType(
            'Extrinsic',
            { method: signerPayload.method },
            { version: 4 }
        );

        extrinsic.addSignature(keyPair.address, signature, signerPayload.toHex());

        return {
            id: 0,
            signature: signature,
            // Extrinsic with Mode and MetadataHash added
            signedTransaction: extrinsic.toHex(),
        }
    }
}

const main = async () => {
    await cryptoWaitReady();

    // When active it will use a alice keypair
    const isDev = process.argv[2] === '--dev';

    const api = await ApiPromise.create({
        provider: new WsProvider(isDev ? DEV_WS_URL : WS_URL),
        signer
    });

    await api.isReady;

    const ss58 = (api.consts.system.ss58Prefix as u16).toNumber();
    const keyPair = isDev ? createDevKeyPair(ss58) : await createKeyPair(ss58);
    
    await api.tx.balances.transferKeepAlive('D3R6bYhvjhSfuQs68QvV3JUmFQf6DWgHqQVCFx4JXD253bk', '100000000').signAndSend(keyPair.address);
}

main().catch(e => console.error(e)).finally(() => process.exit());
