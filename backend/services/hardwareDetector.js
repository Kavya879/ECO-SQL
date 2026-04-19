/**
 * Hardware Detection Service
 * Automatically detects system hardware specifications
 * All values are deterministic and consistent across calls
 */

const os = require('os');

// Cache hardware config to ensure consistency across requests
let hardwareConfigCache = null;

/**
 * Detect CPU specifications
 * @returns {object} CPU info { cores, modelName, powerPerCore }
 */
function detectCPU() {
  const cpus = os.cpus();
  const cores = cpus.length;
  const modelName = cpus[0]?.model || 'Unknown CPU';
  
  // Estimate power per core based on CPU model - deterministic
  let powerPerCore = 10; // Default conservative estimate: 10W per core
  
  if (modelName.includes('Xeon') || modelName.includes('EPYC')) {
    powerPerCore = 15; // Server CPUs: 12-18W
  } else if (modelName.includes('i9') || modelName.includes('Ryzen 9')) {
    powerPerCore = 12; // High-end desktop: 10-15W
  } else if (modelName.includes('i7') || modelName.includes('Ryzen 7')) {
    powerPerCore = 10; // Mid-range desktop: 8-12W
  } else if (modelName.includes('i5') || modelName.includes('Ryzen 5')) {
    powerPerCore = 8; // Budget: 6-10W
  } else if (modelName.includes('i3') || modelName.includes('Ryzen 3')) {
    powerPerCore = 6; // Entry-level: 4-8W
  } else if (modelName.includes('M1') || modelName.includes('M2') || modelName.includes('M3') || modelName.includes('M4')) {
    powerPerCore = 2; // Apple Silicon is extremely efficient: 1-3W
  } else if (modelName.includes('Intel') && modelName.includes('Core')) {
    powerPerCore = 10; // Generic Intel Core
  }
  
  return { cores, modelName, powerPerCore };
}

/**
 * Detect RAM - deterministic
 * @returns {number} RAM in GB
 */
function detectRAM() {
  const totalMemory = os.totalmem();
  const ramGb = totalMemory / (1024 ** 3);
  return Math.round(ramGb * 10) / 10; // Round to 1 decimal place
}

/**
 * Estimate Power Usage Effectiveness (PUE)
 * PUE = Total facility power / IT equipment power
 * Typical values: On-premises: 1.5-2.0, Cloud: 1.1-1.3  * Reference: https://www.greensoftware.foundation
 * @returns {number} PUE estimate
 */
function estimatePUE() {
  // Check environment variable first (can be overridden for cloud/on-prem)
  if (process.env.PUE) {
    const pueVal = parseFloat(process.env.PUE);
    if (!isNaN(pueVal) && pueVal >= 1 && pueVal <= 3) {
      return pueVal;
    }
  }
  
  const platform = os.platform();
  
  if (process.env.INFRASTRUCTURE === 'cloud') {
    return 1.15; // Modern cloud data centers (AWS, Google, Azure)
  }
  
  // Conservative estimate: on-premises typical office/data center
  return 1.3; // More realistic for typical setups
}

/**
 * Estimate total embodied carbon (TE) - fixed, not system-dependent
 * Reference: https://www.greensoftware.foundation
 * Based on desktop/workstation hardware average
 * Typical: Desktop ~75-100 kgCO2eq, Server ~150-250 kgCO2eq
 * @returns {number} TE in gCO2eq
 */
function estimateEmbodiedCarbon() {
  // Check environment variable first
  if (process.env.EMBODIED_CARBON) {
    const teVal = parseFloat(process.env.EMBODIED_CARBON);
    if (!isNaN(teVal) && teVal > 0) {
      return teVal;
    }
  }
  
  if (process.env.HARDWARE_TYPE === 'server') {
    return 200000; // ~200 kgCO2eq for server hardware
  }
  
  if (process.env.HARDWARE_TYPE === 'laptop') {
    return 75000; // ~75 kgCO2eq for laptop
  }
  
  // Default: typical desktop/workstation
  return 100000; // ~100 kgCO2eq (middle estimate)
}

/**
 * Estimate hardware lifespan (EL) in hours - deterministic
 * Standard estimate: 5.5 years = ~48,180 hours
 * Reference: Green Algorithms 2021, typical hardware lifespan
 * @returns {number} EL in hours
 */
function estimateHardwareLifespan() {
  // Standard estimate: 5.5 years operational lifespan
  // 5.5 * 365 * 24 = 48,180 hours
  return 5.5 * 365.25 * 24;
}

/**
 * Estimate reserved resource ratio (RR) - deterministic
 * Percentage of resources reserved for the query vs. total system
 * For a single query: typically 1-10% of total system capacity
 * @returns {number} RR between 0 and 1
 */
function estimateReservedRatio() {
  if (process.env.RESERVED_RATIO) {
    const rrVal = parseFloat(process.env.RESERVED_RATIO);
    if (!isNaN(rrVal) && rrVal >= 0 && rrVal <= 1) {
      return rrVal;
    }
  }
  
  // Standard estimate: single query uses ~5% of system resources
  return 0.05;
}

/**
 * Estimate total operating time (ToR) in hours - deterministic
 * Expected time system will be used in its lifetime
 * Typical: 8 hours/day * 250 working days/year * 5.5 year lifespan = 11,000 hours
 * @returns {number} ToR in hours
 */
function estimateTotalOperatingTime() {
  if (process.env.TOTAL_OPERATING_HOURS) {
    const torVal = parseFloat(process.env.TOTAL_OPERATING_HOURS);
    if (!isNaN(torVal) && torVal > 0) {
      return torVal;
    }
  }
  
  // 8 operating hours/day, 250 working days/year, 5.5 year lifespan
  // = 8 * 250 * 5.5 = 11,000 hours
  return 11000;
}

/**
 * Estimate grid carbon intensity (gCO2eq/kWh) - deterministic
 * Global average: ~475 gCO2/kWh (2024)
 * Regional examples: India: 440, US: 386, EU: 233, Canada: 154, France: 45
 * Reference: Ember, IEA, global carbon intensity database
 * Can be overridden by GRID_CARBON_INTENSITY env var
 * @returns {number} Grid intensity in gCO2eq/kWh
 */
function estimateGridIntensity() {
  if (process.env.GRID_CARBON_INTENSITY) {
    const gridVal = parseFloat(process.env.GRID_CARBON_INTENSITY);
    if (!isNaN(gridVal) && gridVal > 0) {
      return gridVal;
    }
  }
  
  // Global average carbon intensity (better than India-specific)
  return 475;
}

/**
 * Estimate CPU utilization (0-1) - deterministic
 * For a single database query on multi-core systems
 * Typical: 30-70% utilization depending on query complexity
 * @returns {number} CPU utilization 0-1
 */
function estimateCpuUtilization() {
  if (process.env.CPU_UTILIZATION) {
    const cpuUtilVal = parseFloat(process.env.CPU_UTILIZATION);
    if (!isNaN(cpuUtilVal) && cpuUtilVal >= 0 && cpuUtilVal <= 1) {
      return cpuUtilVal;
    }
  }
  
  // Conservative middle estimate: 50%
  return 0.5;
}

/**
 * Get complete auto-detected hardware configuration
 * Caches result for consistency across requests
 * @returns {object} Hardware config with all parameters
 */
function getAutoDetectedConfig() {
  // Return cached config if available for consistency across requests
  if (hardwareConfigCache) {
    return { ...hardwareConfigCache };
  }
  
  const cpu = detectCPU();
  
  const config = {
    cpuCores: cpu.cores,
    powerPerCore: cpu.powerPerCore,
    cpuUtilization: estimateCpuUtilization(),
    ramGb: detectRAM(),
    pue: estimatePUE(),
    gridIntensity: estimateGridIntensity(),
    te: estimateEmbodiedCarbon(),
    el: estimateHardwareLifespan(),
    rr: estimateReservedRatio(),
    tor: estimateTotalOperatingTime(),
    _metadata: {
      cpuModel: cpu.modelName,
      platform: os.platform(),
      arch: os.arch(),
      detectedAt: new Date().toISOString(),
    },
  };
  
  // Cache for consistency
  hardwareConfigCache = { ...config };
  
  return config;
}

/**
 * Merge user-provided config with auto-detected defaults
 * User-provided values take precedence
 * @param {object} userConfig - User-provided configuration
 * @returns {object} Merged configuration
 */
function mergeWithDefaults(userConfig = {}) {
  const autoConfig = getAutoDetectedConfig();
  
  // Override auto-detected values with user-provided ones
  const merged = { ...autoConfig };
  
  if (userConfig.cpuCores !== undefined && userConfig.cpuCores !== null) {
    merged.cpuCores = parseFloat(userConfig.cpuCores);
  }
  if (userConfig.powerPerCore !== undefined && userConfig.powerPerCore !== null) {
    merged.powerPerCore = parseFloat(userConfig.powerPerCore);
  }
  if (userConfig.cpuUtilization !== undefined && userConfig.cpuUtilization !== null) {
    merged.cpuUtilization = parseFloat(userConfig.cpuUtilization);
  }
  if (userConfig.ramGb !== undefined && userConfig.ramGb !== null) {
    merged.ramGb = parseFloat(userConfig.ramGb);
  }
  if (userConfig.pue !== undefined && userConfig.pue !== null) {
    merged.pue = parseFloat(userConfig.pue);
  }
  if (userConfig.gridIntensity !== undefined && userConfig.gridIntensity !== null) {
    merged.gridIntensity = parseFloat(userConfig.gridIntensity);
  }
  if (userConfig.te !== undefined && userConfig.te !== null) {
    merged.te = parseFloat(userConfig.te);
  }
  if (userConfig.el !== undefined && userConfig.el !== null) {
    merged.el = parseFloat(userConfig.el);
  }
  if (userConfig.rr !== undefined && userConfig.rr !== null) {
    merged.rr = parseFloat(userConfig.rr);
  }
  if (userConfig.tor !== undefined && userConfig.tor !== null) {
    merged.tor = parseFloat(userConfig.tor);
  }
  
  delete merged._metadata;
  return merged;
}

module.exports = {
  detectCPU,
  detectRAM,
  estimatePUE,
  estimateEmbodiedCarbon,
  estimateHardwareLifespan,
  estimateReservedRatio,
  estimateTotalOperatingTime,
  estimateGridIntensity,
  estimateCpuUtilization,
  getAutoDetectedConfig,
  mergeWithDefaults,
};
