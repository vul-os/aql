from physics import simulate_stacked_system
from benchmark import save_circular_coil_template
import numpy as np

# Find minimum turns for 85% efficiency WITHOUT stacking (single layer)
INNER_RADIUS = 100  # 200mm ID
NUM_LAYERS = 1      # SINGLE LAYER - NO STACKING
LAYER_GAP = 0       # Not used for single layer
TARGET_AIR_GAP = 40 # mm
FREQ = 40000        # 40kHz
TARGET_EFFICIENCY = 0.85  # 85%

print("=" * 70)
print("Finding Minimum Turns for 85% Efficiency (SINGLE LAYER)")
print("=" * 70)
print(f"Target: {TARGET_EFFICIENCY*100}% efficiency @ {TARGET_AIR_GAP}mm air gap")
print(f"Configuration: Single layer (no stacking)")
print(f"Inner Diameter: {INNER_RADIUS * 2}mm")
print("=" * 70)

wire_dia = 0.7  # mm
pitch = wire_dia + 1.0  # 1.7mm

print(f"\nTesting different turn counts...")
print("-" * 70)

results = []
turn_options = range(5, 35, 1)  # Test 5 to 34 turns

for turns in turn_options:
    outer_radius = INNER_RADIUS + (turns - 1) * pitch
    outer_diameter = 2 * outer_radius
    
    # Skip if OD exceeds 300mm
    if outer_diameter > 300:
        continue
    
    res = simulate_stacked_system(
        INNER_RADIUS,
        turns,
        pitch,
        wire_dia,
        NUM_LAYERS,  # Single layer
        LAYER_GAP,
        TARGET_AIR_GAP,
        FREQ
    )
    
    results.append({
        'turns': turns,
        'od': outer_diameter,
        'L': res['L_tx_uH'],
        'k': res['k'],
        'Q': res['Q'],
        'eff': res['eff'],
        'wire_length': res['wire_length_m'],
        'C_nF': res['C_resonant_nF']
    })
    
    status = "✓" if res['eff'] >= TARGET_EFFICIENCY else "✗"
    print(f"{status} {turns:2d} turns: OD={outer_diameter:5.1f}mm, L={res['L_tx_uH']:6.2f}µH, k={res['k']:.4f}, Q={res['Q']:5.1f}, Eff={res['eff']*100:5.1f}%")

# Find minimum turns that meet target
meeting_target = [r for r in results if r['eff'] >= TARGET_EFFICIENCY]

print("\n" + "=" * 70)
if meeting_target:
    best = meeting_target[0]  # First one that meets target (minimum turns)
    print(f"✓ MINIMUM TURNS FOUND: {best['turns']} turns")
    print("=" * 70)
    print(f"Configuration:")
    print(f"  Turns: {best['turns']}")
    print(f"  Inner Diameter: {INNER_RADIUS * 2}mm")
    print(f"  Outer Diameter: {best['od']:.1f}mm")
    print(f"  Wire Diameter: {wire_dia}mm")
    print(f"  Pitch: {pitch:.2f}mm")
    print(f"  Wire Length: {best['wire_length']:.2f}m")
    print(f"\nElectrical Performance @ {TARGET_AIR_GAP}mm:")
    print(f"  Inductance: {best['L']:.2f}µH")
    print(f"  Coupling (k): {best['k']:.4f}")
    print(f"  Q Factor: {best['Q']:.1f}")
    print(f"  Link Efficiency: {best['eff']*100:.1f}%")
    print(f"  Resonant Capacitor: {best['C_nF']:.1f}nF")
    
    # Generate visualization
    print(f"\nGenerating coil template...")
    num_turns = best['turns']
    save_circular_coil_template(
        od_mm=best['od'],
        id_mm=INNER_RADIUS * 2,
        pitch=pitch,
        num_turns=num_turns,
        name=f"Single_Layer_{num_turns}Turns"
    )
    
    # Show comparison with other options
    print("\n" + "=" * 70)
    print("Comparison with other turn counts:")
    print("=" * 70)
    print(f"{'Turns':<8} {'OD (mm)':<10} {'Efficiency':<12} {'Wire (m)':<10} {'Cap (nF)':<10}")
    print("-" * 70)
    for r in meeting_target[:5]:  # Show first 5 that meet target
        print(f"{r['turns']:<8} {r['od']:<10.1f} {r['eff']*100:<12.1f} {r['wire_length']:<10.2f} {r['C_nF']:<10.1f}")
    
else:
    print("✗ NO CONFIGURATION MEETS TARGET")
    print("=" * 70)
    print("Best achievable:")
    best_available = max(results, key=lambda x: x['eff'])
    print(f"  Turns: {best_available['turns']}")
    print(f"  Efficiency: {best_available['eff']*100:.1f}%")
    print(f"  (Need {(TARGET_EFFICIENCY - best_available['eff'])*100:.1f}% more)")

print("\n" + "=" * 70)
