#!/usr/bin/env tsx
/**
 * 测试 fluxion 实例管理器功能
 */

import { getInstanceManager } from '../src/cluster/launcher.js';

const manager = getInstanceManager();

console.log('=== Testing Fluxion Instance Manager ===\n');

// 测试注册实例
console.log('1. Testing instance registration...');
try {
  manager.registerInstance(
    '/home/aldia/projects/framework/fluxion-ts/fluxion.config.ts',
    'localhost',
    9000,
    9001,
  );
  console.log('✓ Instance registered successfully\n');
} catch (error) {
  console.error('✗ Failed to register instance:', error);
  process.exit(1);
}

// 测试获取运行实例
console.log('2. Testing get running instances...');
try {
  const instances = manager.getRunningInstances();
  console.log(`✓ Found ${instances.length} running instance(s)`);
  if (instances.length > 0) {
    const instance = instances[0];
    console.log(`  - PID: ${instance.pid}`);
    console.log(`  - Port: ${instance.port}`);
    console.log(`  - Config Hash: ${instance.configHash.slice(0, 16)}...`);
  }
  console.log('');
} catch (error) {
  console.error('✗ Failed to get running instances:', error);
}

// 测试打印实例
console.log('3. Testing print instances...');
try {
  manager.printInstances();
  console.log('✓ Instances printed successfully\n');
} catch (error) {
  console.error('✗ Failed to print instances:', error);
}

// 测试注销实例
console.log('4. Testing instance unregistration...');
try {
  manager.unregisterInstance();
  console.log('✓ Instance unregistered successfully\n');
} catch (error) {
  console.error('✗ Failed to unregister instance:', error);
}

// 验证注销后的状态
console.log('5. Verifying instance state after unregistration...');
try {
  const instances = manager.getRunningInstances();
  console.log(`✓ Current running instances: ${instances.length}`);
  if (instances.length === 0) {
    console.log('  No instances running (as expected)\n');
  } else {
    console.log('  Unexpected: instances still registered\n');
  }
} catch (error) {
  console.error('✗ Failed to verify instance state:', error);
}

console.log('=== Test Complete ===');
