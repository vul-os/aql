# Wireless Power Transfer Coil Design Summary
# Generated: 2025-12-31

## Design Requirements
- Inner Diameter: 200mm (fixed)
- Operating Frequency: 40kHz
- Target Air Gap: 40mm
- Wire Diameter: 0.7mm
- Pitch: 1.7mm (0.7mm wire + 1.0mm gap)

## Three Design Options

### Option 1: MINIMUM TURNS (Single Layer - 8 Turns)
**Best for: Simplicity, Cost, Compact Size**

Physical Specifications:
- Configuration: Single layer, 8 turns
- Inner Diameter: 200mm
- Outer Diameter: 223.8mm
- Wire Length: 5.33m
- Total Turns: 8

Electrical Performance @ 40mm:
- Inductance: 30.78µH
- Coupling (k): 0.3093
- Q Factor: 41.8
- Link Efficiency: 85.7%
- Resonant Capacitor: 514.4nF

Pros:
✓ Most compact (223.8mm OD)
✓ Least wire needed (5.33m)
✓ Easiest to manufacture
✓ Lowest cost
✓ Meets 85% efficiency target

Cons:
✗ Lower efficiency than other options
✗ Large capacitor needed (514nF)


### Option 2: BALANCED (Stacked - 2 Layers × 8 Turns)
**Best for: Balance of Size and Performance**

Physical Specifications:
- Configuration: 2 layers × 8 turns (stacked)
- Inner Diameter: 200mm
- Outer Diameter: 223.8mm
- Layer Gap: 1.5mm
- Total Stack Height: 1.5mm
- Wire Length: 10.65m
- Total Turns: 16

Electrical Performance @ 40mm:
- Inductance: 118.46µH
- Coupling (k): 0.3215
- Q Factor: 70.1
- Link Efficiency: 91.5%
- Resonant Capacitor: 133.6nF

Pros:
✓ Compact OD (223.8mm - same as single layer!)
✓ Excellent efficiency (91.5%)
✓ Moderate capacitor value (133.6nF)
✓ 4× inductance vs single layer
✓ Only 1.5mm thick

Cons:
✗ More complex to manufacture (stacking required)
✗ 2× wire length vs single layer


### Option 3: MAXIMUM EFFICIENCY (Stacked - 2 Layers × 29 Turns)
**Best for: Maximum Performance**

Physical Specifications:
- Configuration: 2 layers × 29 turns (stacked)
- Inner Diameter: 200mm
- Outer Diameter: 295.2mm
- Layer Gap: 1.5mm
- Total Stack Height: 1.5mm
- Wire Length: 45.12m
- Total Turns: 58

Electrical Performance @ 40mm:
- Inductance: 1288.56µH
- Coupling (k): 0.4763
- Q Factor: 115.7
- Link Efficiency: 96.4%
- Resonant Capacitor: 12.3nF

Pros:
✓ Highest efficiency (96.4%)
✓ Best coupling coefficient
✓ Highest Q factor
✓ Small capacitor value (12.3nF)

Cons:
✗ Largest OD (295.2mm)
✗ Most wire needed (45.12m)
✗ Most complex to manufacture
✗ Highest cost


## Comparison Table

| Parameter              | Option 1 (8T)  | Option 2 (2×8T) | Option 3 (2×29T) |
|------------------------|----------------|-----------------|------------------|
| **Configuration**      | Single Layer   | Stacked         | Stacked          |
| **Total Turns**        | 8              | 16              | 58               |
| **Outer Diameter**     | 223.8mm        | 223.8mm         | 295.2mm          |
| **Wire Length**        | 5.33m          | 10.65m          | 45.12m           |
| **Inductance**         | 30.78µH        | 118.46µH        | 1288.56µH        |
| **Efficiency @ 40mm**  | 85.7%          | 91.5%           | 96.4%            |
| **Capacitor**          | 514.4nF        | 133.6nF         | 12.3nF           |
| **Complexity**         | Simple         | Moderate        | Complex          |
| **Cost**               | Low            | Medium          | High             |


## Recommendation

**OPTION 2: Stacked 2 Layers × 8 Turns** ⭐

This is the sweet spot:
- Same compact size as Option 1 (223.8mm OD)
- Significantly better efficiency (91.5% vs 85.7%)
- Reasonable capacitor value (133.6nF)
- Only 1.5mm thick stack
- Good balance of performance, size, and manufacturability

The 5.9% efficiency gain over Option 1 is worth the extra complexity of stacking,
while avoiding the large size and wire requirements of Option 3.


## Manufacturing Notes

For Stacked Designs (Options 2 & 3):
1. Wind Layer 1 on bottom
2. Add 1.5mm insulation/spacer
3. Wind Layer 2 on top
4. Connect layers in series (same current direction)
5. Ensure proper alignment for maximum coupling

For All Designs:
- Use 0.7mm enameled copper wire
- Maintain 1.7mm pitch (center-to-center)
- Consider Litz wire for frequencies >40kHz
- Use CBB film capacitors rated 630V-1000V
- Add ferrite backing for improved coupling (optional)


## Files Generated
- Single_Layer_8Turns_A3.png
- Stacked_8Turns_Design_A3.png
- Stacked_Coil_Design_A3.png (29 turns)
- Stacked_Efficiency_vs_AirGap.png
