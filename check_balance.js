import axios from 'axios';
import fs from 'fs/promises';

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
    }
};

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

async function checkBalances() {
    const addresses = (await fs.readFile('address.txt', 'utf-8'))
        .split('\n')
        .map(addr => addr.trim())
        .filter(addr => addr);

    logger.info(`开始查询 ${addresses.length} 个地址的余额`);
    
    const results = [];
    const zeroBalanceAddresses = [];

    for (const address of addresses) {
        const result = await checkBalance(address);
        if (result.success) {
            logger.success(`地址: ${address} | 余额: ${result.balanceInSui} SUI`);
            if (result.balance === '0') {
                zeroBalanceAddresses.push(address);
            }
        } else {
            logger.error(`地址: ${address} | 查询失败: ${result.error}`);
        }
        results.push(result);
        
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 保存余额为0的地址
    if (zeroBalanceAddresses.length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.writeFile(
            'zero_balance_addresses.txt',
            zeroBalanceAddresses.join('\n')
        );
        logger.info(`已将 ${zeroBalanceAddresses.length} 个余额为0的地址保存到 zero_balance_addresses.txt`);
    }

    // 保存完整查询结果
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(
        `balance_check_${timestamp}.json`,
        JSON.stringify(results, null, 2)
    );

    // 统计信息
    const totalBalance = results.reduce((sum, r) => sum + Number(r.balance), 0);
    const totalBalanceInSui = totalBalance / 1000000000;
    const successCount = results.filter(r => r.success).length;
    const zeroBalanceCount = zeroBalanceAddresses.length;
    const nonZeroBalanceCount = results.filter(r => r.balance !== '0').length;
    
    logger.info('\n=== 统计信息 ===');
    logger.info(`总地址数: ${addresses.length}`);
    logger.info(`成功查询: ${successCount}`);
    logger.info(`余额为0: ${zeroBalanceCount}`);
    logger.info(`余额非0: ${nonZeroBalanceCount}`);
    logger.info(`总余额: ${totalBalanceInSui.toFixed(4)} SUI`);
    logger.info(`平均余额: ${(totalBalanceInSui / successCount).toFixed(4)} SUI`);
}

checkBalances(); 