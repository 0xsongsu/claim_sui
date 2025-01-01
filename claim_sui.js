import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs/promises';
import fakeUa from 'fake-useragent';

// 创建logger函数
const logger = {
    info: (msg) => {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] INFO: ${msg}`);
    },
    success: (msg) => {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] ✅ ${msg}`);
    },
    error: (msg) => {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] ❌ ${msg}`);
    },
    warn: (msg) => {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] ⚠️ ${msg}`);
    }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 配置参数
const MAX_RETRIES = 20;
const RETRY_DELAY = 2000;
const MAX_CONCURRENT = 20; // 最大并发数

// 线程池类
class ThreadPool {
    constructor(maxThreads) {
        this.maxThreads = maxThreads;
        this.queue = [];
        this.activeThreads = 0;
    }

    async add(task) {
        if (this.activeThreads >= this.maxThreads) {
            // 等待某个任务完成
            await new Promise(resolve => this.queue.push(resolve));
        }
        
        this.activeThreads++;
        try {
            return await task();
        } finally {
            this.activeThreads--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next();
            }
        }
    }

    async waitAll() {
        while (this.activeThreads > 0) {
            await sleep(100);
        }
    }
}

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// 检查余额
async function checkBalance(address) {
    try {
        const { data } = await axios.post('https://rpc-testnet.suiscan.xyz/', {
            jsonrpc: "2.0",
            id: 1,
            method: "suix_getBalance",
            params: [address, "0x2::sui::SUI"]
        });
        
        const balance = data.result?.totalBalance || '0';
        const balanceInSui = Number(balance) / 1000000000;

        return {
            address,
            balance,
            balanceInSui: balanceInSui.toFixed(4),
            success: true
        };
    } catch (error) {
        return {
            address,
            balance: '0',
            balanceInSui: '0',
            success: false,
            error: error.message
        };
    }
}

async function claimSuiTestnet(address, proxyUrl, retryCount = 0) {
    try {
        const userAgent = fakeUa();

        const headers = {   
            'accept': 'application/json, text/plain, */*',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'cache-control': 'no-cache',
            'content-type': 'application/json',
            'origin': 'https://faucet.blockbolt.io',
            'pragma': 'no-cache',
            'referer': 'https://faucet.blockbolt.io/',
            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'user-agent': userAgent
        };

        const response = await axios.post('https://faucet.testnet.sui.io/v1/gas', 
            {
                FixedAmountRequest: {
                    recipient: address
                }
            }, 
            { 
                headers, 
                httpsAgent: new HttpsProxyAgent(proxyUrl),
                timeout: 30000
            }
        );

        const balanceResult = await checkBalance(address);
        
        const result = {
            timestamp: new Date().toISOString(),
            address: address,
            status: response.status,
            response: response.data
        };

        if (response.status === 202) {
            logger.success(`领取成功 | 地址: ${address} | 余额: ${balanceResult.balanceInSui} SUI`);
            await fs.appendFile('sui_claim_success.txt', JSON.stringify(result, null, 2) + '\n---\n');
            return true;
        } else {
            if (retryCount < MAX_RETRIES) {
                await sleep(RETRY_DELAY);
                return await claimSuiTestnet(address, proxyUrl, retryCount + 1);
            } else {
                logger.error(`达到最大重试次数 | 地址: ${address}`);
                await fs.appendFile('sui_claim_warning.txt', JSON.stringify(result, null, 2) + '\n---\n');
                return false;
            }
        }

    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            await sleep(RETRY_DELAY);
            return await claimSuiTestnet(address, proxyUrl, retryCount + 1);
        } else {
            const errorInfo = {
                timestamp: new Date().toISOString(),
                address: address,
                error: error.message,
                status: error.response?.status,
                response: error.response?.data
            };
            logger.error(`领取失败 | 地址: ${address} | 错误: ${error.message}`);
            await fs.appendFile('sui_claim_error.txt', JSON.stringify(errorInfo, null, 2) + '\n---\n');
            return false;
        }
    }
}

async function processAddresses() {
    try {
        const addresses = (await fs.readFile('address.txt', 'utf-8'))
            .split('\n')
            .map(addr => addr.trim())
            .filter(addr => addr);

        logger.info(`总共找到 ${addresses.length} 个地址需要处理`);
        
        const proxyUrl = " ";     
        let successCount = 0;
        let failCount = 0;

        const pool = new ThreadPool(MAX_CONCURRENT);
        
        // 创建所有任务
        const tasks = addresses.map(address => async () => {
            const success = await claimSuiTestnet(address, proxyUrl);
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
            // 随机延迟 3-7 秒
            await sleep(3000 + Math.random() * 4000);
        });

        // 执行所有任务
        await Promise.all(tasks.map(task => pool.add(task)));
        
        // 等待所有任务完成
        await pool.waitAll();

        logger.info('\n=== 统计信息 ===');
        logger.info(`总地址数: ${addresses.length}`);
        logger.success(`成功: ${successCount}`);
        logger.error(`失败: ${failCount}`);

    } catch (error) {
        logger.error(`读取地址文件错误: ${error.message}`);
    }
}

// 运行程序
processAddresses(); 