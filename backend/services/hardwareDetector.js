/**
 * Hardware Detection Service
 * Automatically detects system hardware specifications
 */

const os = require('os');

/**
 * Detect CPU specifications
 * @returns {object} CPU info { cores, modelName, powerPerCore }
 */
function detectCPU() {
  const cpus = os.cpus();
  const cores = cpus.length;
  const modelName = cpus[0]?.model || 'Unknown CPU';
  
  // Estimate power per core based on CPU model
  // Default conservative estimate: 10W per core (typical for modern CPUs: 5-15W)
  let powerPerCore = 10;
  
  if (modelName.includes('Xeon') || modelName.includes('EPYC')) {
    powerPerCore = 12; // Server CPUs typically consume more
  } else if (modelName.includes('i9') || modelName.includes('Ryzen 9')) {
    powerPerCore = 12;
  } else if (modelName.includes('i7') || modelName.includes('Ryzen 7')) {
    powerPerCore = 10;
  } else if (modelName.includes('i5') || modelName.includes('Ryzen 5')) {
    powerPerCore = 8;
  } else if (modelName.includes('M1') || modelName.includes('M2') || modelName.includes('M3')) {
    powerPerCore = 3; // Apple Silicon is very efficient
  }
  
  return { cores, modelName, powerPerCore };
}

/**
 * Detect RAM
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
 * Typical values: On-premises: 1.5-2.0, Cloud: 1.1-1.3, Home office: 1.0-1.1
 * @returns {number} PUE estimate
 */
function estimatePUE() {
  const platform = os.platform();
  
  if (process.env.INFRASTRUCTURE === 'cloud') {
    return 1.15; // Modern cloud data centers are very efficient
  }
  
  // Assume on-premises unless explicitly set to cloud
  // Conservative estimate for typical office/data center
  return 1.67;
}

/**
 * Estimate total embodied carbon (TE)
 * Based on typical hardware lifespans and manufacturing impact
 * Rule of thumb: ~150-300 kgCO2eq for typical server hardware
 * ~50-100 kgCO2eq for typical desktop/laptop
 * @returns {number} TE in gCO2eq
 */
function estimateEmbodiedCarbon() {
  const platform = os.platform();
  
  if (process.env.HARDWARE_TYPE === 'server') {
    // Server hardware: ~200 kgCO2eq = 200,000 gCO2eq
    return 200000;
  }
  
  if (process.env.HARDWARE_TYPE === 'laptop') {
    // Laptop: ~75 kgCO2eq = 75,000 gCO2eq
    return 75000;
  }
  
  // Default: assume typical desktop/workstation
  // ~100 kgCO2eq = 100,000 gCO2eq
  return 100000;
}

/**
 * Estimate hardware lifespan (EL) in hours
 * Typical values: 5-7 years = ~44,000-61,000 hours
 * @returns {number} EL in hours
 */
function estimateHardwareLifespan() {
  // Standard estimate: 5.5 years operational lifespan
  return 5.5 * 365 * 24; // ~48,180 hours
}

/**
 * Estimate reserved resource ratio (RR)
 * Percentage of resources reserved for the query vs. total system
 * For a single query on a system, typically 1-10%
 * @returns {number} RR between 0 and 1
 */
function estimateReservedRatio() {
  // Conservative: assume single query uses ~5% of system resources
  return 0.05;
}

/**
 * Estimate total operating time (ToR) in hours
 * Expected time system will be used
 * Typical: 8-10 hours/day * 250 working days/year * expected_life
 * @returns {number} ToR in hours
 */
function estimateTotalOperatingTime() {
  // 8 operating hours/day, 250 working days/year, 5.5 year lifespan
  return 8 * 250 * 5.5; // ~11,000 hours
}

/**
 * Estimate grid carbon intensity (gCO2eq/kWh)
 * Varies by region; default is global average (~475 gCO2/kWh)
 * Can be overridden by GRID_CARBON_INTENSITY env var
 * @returns {number} Grid intensity in gCO2eq/kWh
 */
function estimateGridIntensity() {
  if (process.env.GRID_CARBON_INTENSITY) {
    return parseFloat(process.env.GRID_CARBON_INTENSITY);
  }
  
  // Global average carbon intensity
  return 475;
}

/**
 * Estimate CPU utilization (0-1)
 * For single query: typically 0.3-0.7 on modern multi-core systems
 * @returns {number} CPU utilization 0-1
 */
function estimateCpuUtilization() {
  return 0.5; // Conservative middle estimate
}

/**
 * Get complete auto-detected hardware configuration
 * @returns {object} Hardware config with all parameters
 */
function getAutoDetectedConfig() {
  const cpu = detectCPU();
  
  return {
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
