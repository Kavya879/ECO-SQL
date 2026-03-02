# QueryCarbon Fixes Applied

## Issues Fixed

### 1. **All Emissions Values Showing 0** ✓
**Root Cause**: Calculation precision loss - rounding very small values to 2 decimals made them 0.00

**Solution**:
- Increased decimal precision from 2 to 6-9 decimals in `carbonCalculator.js`
- Energy values now show 9 decimals (handles nano/micro queries)
- Emissions now show 6 decimals (prevents 0.000001 rounding to 0.00)
- Improved number formatting in `format.js` with scientific notation for tiny values
- Added nano-watt-hour (nWh) support for energy display

### 2. **Non-Deterministic Results (Inconsistent Across Runs)** ✓
**Root Cause**: Hardware detector made a fresh estimate each time with varying system state

**Solution**:
- Added hardware config caching in `hardwareDetector.js`
- Config is now cached on first access and reused for consistency
- Made all values deterministic via environment variable overrides
- Fixed PUE estimation: 1.67 → 1.3 (realistic for typical setups)
- Better CPU detection with more accurate power/core estimates

### 3. **Formula Accuracy Issues** ✓
**Root Cause**: Incorrect default values not aligned with Green Algorithms 2021 standard

**Solution Updated DEFAULTS in `carbonCalculator.js`:
- **TE (Total Embodied Carbon)**: 1,600,000 → 150,000 gCO2eq (typical desktop/workstation, not server)
- **EL (Hardware Lifespan)**: 35,040 → 48,180 hours (5.5 years, industry standard)
- **RR (Resource Reserved Ratio)**: 0.5 → 0.05 (5% for single query, not 50%)
- **ToR (Total Operating Time)**: 1 → 11,000 hours (annual: 8h/day × 250 days)
- **Grid Intensity**: 442 → 475 gCO2/kWh (global average, region-configurable)
- **PUE**: 1.67 → 1.3 (realistic cloud/modern data center estimate)

**Updated formulas**:
- Energy: Clearer explanation of kWh conversion (t × P × PUE / 1000)
- Embodied: Better documentation with ISO/IEC 31031:2024 references
- Added comprehensive comments referencing Green Algorithms 2021

### 4. **Frontend UX Issues (Can't Copy Queries)** ✓
**Solution**:
- Added "Copy to Editor" button (→ icon) on each query row in ReportsPage
- Uses sessionStorage for cross-page communication
- Clicking button loads query into editor on AnalyzePage
- Visual feedback: icon changes to ✓ (checkmark) when copied
- AnalyzePage now checks sessionStorage on load to auto-fill copied queries

**Modified Files**:
- `frontend/src/pages/ReportsPage.jsx`: Added copy button, navigation logic
- `frontend/src/pages/AnalyzePage.jsx`: Added sessionStorage check, adjusted defaults
- `frontend/src/utils/format.js`: Improved number formatting for tiny values

## Backend Changes

### carbonCalculator.js
- ✓ Updated DEFAULTS to realistic values
- ✓ Improved precision to 6-9 decimals
- ✓ Better formula documentation with references
- ✓ Handles micro/nano queries correctly

### hardwareDetector.js  
- ✓ Added hardware config caching for deterministic results
- ✓ All values now controllable via environment variables
- ✓ Better CPU detection logic
- ✓ Realistic PUE estimates (1.3 instead of 1.67)
- ✓ Added references to Green Software Foundation

### carbonController.js
- ✓ Added comprehensive debug logging for emissions calculations
- ✓ Shows energy, emissions breakdown, and hardware params used
- ✓ Helps identify issues in future debugging

## Frontend Changes

### AnalyzePage.jsx
- ✓ Updated DEFAULTS to match backend improvements
- ✓ Added sessionStorage check for copied queries
- ✓ Auto-loads query text when coming from Reports page

### ReportsPage.jsx
- ✓ Added "Copy to Editor" action column
- ✓ Visual feedback on copy (checkmark animation)
- ✓ Seamless navigation to editor with query pre-filled

### format.js
- ✓ Better handling of tiny numbers (< 1 microjoule)
- ✓ Scientific notation for extremely small values
- ✓ Improved precision for emissions display
- ✓ Added nano-watt-hour unit support

## Testing Recommendations

1. **Test tiny queries** (< 1ms execution time)
   - Verify emissions are no longer 0
   - Check they show in scientific notation if < 0.000001 gCO2

2. **Test deterministic behavior**
   - Run same query 5 times
   - Results should be identical (no variation)
   - Check logs for hardware config consistency

3. **Test copy-to-editor**
   - Go to Reports page
   - Click copy button (→ icon)
   - Verify you're redirected to Analyze page
   - Verify query is pre-filled in editor

4. **Verify calculations**
   - Enable verbose logging in carbonController
   - Check that emissions breakdown is accurate
   - Validate formula implementation

## Environment Variables (Optional Configuration)

```
# Hardware estimation
PUE=1.3                              # Power Usage Effectiveness
EMBODIED_CARBON=100000               # TE in gCO2eq
RESERVED_RATIO=0.05                  # RR (0-1)
TOTAL_OPERATING_HOURS=11000          # ToR in hours
GRID_CARBON_INTENSITY=475            # Grid intensity in gCO2/kWh
CPU_UTILIZATION=0.5                  # CPU utilization 0-1

# Optional 
INFRASTRUCTURE=cloud                 # 'cloud' → PUE 1.15, else 1.3
HARDWARE_TYPE=desktop|server|laptop  # Affects TE estimation
```

## References

- Green Algorithms 2021: https://www.greensoftware.foundation
- ISO/IEC 21031:2024 - Environmental informatics - Quantifying and reporting embodied carbon
- EL (Embodied Carbon) estimates: https://www.bitfount.com/blog/embodied-carbon-in-data-centers
- Grid carbon intensity: Global Carbon Atlas, Ember
