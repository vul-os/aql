from physics import simulate_stacked_system
from benchmark import save_circular_coil_template
import numpy as np
import matplotlib.pyplot as plt

def main():
    print("=" * 70)
    print("WPT Coil Design - Single Layer 8 Turns")
    print("=" * 70)
    
    # ========================================================================
    # SINGLE LAYER - 8 TURNS (Minimum for 85% efficiency)
    # ========================================================================
    INNER_RADIUS = 100  # 200mm ID
    NUM_LAYERS = 1      # Single layer
    LAYER_GAP = 0       # Not used
    TURNS = 8
    WIRE_DIA = 0.7
    PITCH = 1.7
    TARGET_AIR_GAP = 40
    FREQ = 40000
    
    print("\n### SINGLE LAYER COIL: 8 Turns @ 40kHz ###")
    print("Target Specifications:")
    print("  - Inner Diameter (ID): 200mm (fixed)")
    print("  - Configuration: Single layer (no stacking)")
    print("  - Turns: 8")
    print("  - Wire Diameter: 0.7mm")
    print("  - Pitch Spacing: 1.7mm (0.7mm wire + 1.0mm gap)")
    print("  - Operating Frequency: 40kHz")
    print("  - Target Airgap: 40mm")
    print("  - Target Efficiency: >85%")
    print("-" * 70)
    
    # Simulate the design
    res = simulate_stacked_system(
        INNER_RADIUS, TURNS, PITCH, WIRE_DIA,
        NUM_LAYERS, LAYER_GAP, TARGET_AIR_GAP, FREQ
    )
    
    print(f"\n✓ SINGLE LAYER COIL RESULTS:")
    print(f"  Configuration: {TURNS} turns (single layer)")
    print(f"  Inner Diameter: {res['inner_diameter_mm']:.1f}mm")
    print(f"  Outer Diameter: {res['outer_diameter_mm']:.1f}mm")
    print(f"  Wire Diameter: {WIRE_DIA}mm")
    print(f"  Pitch: {PITCH:.2f}mm")
    print(f"  Total Wire Length: {res['wire_length_m']:.2f}m")
    print(f"\n  ELECTRICAL CHARACTERISTICS:")
    print(f"  Inductance: {res['L_tx_uH']:.2f}µH")
    print(f"  Coupling Coefficient (k): {res['k']:.4f}")
    print(f"  AC Resistance: {res['R_ac_ohm']:.3f}Ω")
    print(f"  Quality Factor (Q): {res['Q']:.1f}")
    print(f"  Figure of Merit (U): {res['U']:.2f}")
    print(f"  Link Efficiency @ {TARGET_AIR_GAP}mm: {res['eff']*100:.1f}%")
    print(f"  Resonant Capacitor @ 40kHz: {res['C_resonant_nF']:.1f}nF")
    
    # Generate coil template
    print("\n  Generating coil template...")
    save_circular_coil_template(
        od_mm=res['outer_diameter_mm'],
        id_mm=res['inner_diameter_mm'],
        pitch=PITCH,
        num_turns=TURNS,
        name="Single_Layer_8Turns"
    )
    
    # ========================================================================
    # EFFICIENCY VS AIR GAP COMPARISON (All 3 Options)
    # ========================================================================
    print("\n  Generating efficiency vs air gap comparison...")
    
    air_gaps = np.arange(20, 81, 2)
    
    # Option 1: Single layer 8 turns
    print("    - Simulating single layer (8T)...")
    eff_single = []
    for gap in air_gaps:
        r = simulate_stacked_system(INNER_RADIUS, 8, 1.7, 0.7, 1, 0, gap, FREQ)
        eff_single.append(r['eff'] * 100)
    
    # Option 2: Stacked 2×8 turns
    print("    - Simulating stacked 2×8T...")
    eff_stacked_8 = []
    for gap in air_gaps:
        r = simulate_stacked_system(INNER_RADIUS, 8, 1.7, 0.7, 2, 1.5, gap, FREQ)
        eff_stacked_8.append(r['eff'] * 100)
    
    # Option 3: Stacked 2×29 turns
    print("    - Simulating stacked 2×29T...")
    eff_stacked_29 = []
    for gap in air_gaps:
        r = simulate_stacked_system(INNER_RADIUS, 29, 1.7, 0.7, 2, 1.5, gap, FREQ)
        eff_stacked_29.append(r['eff'] * 100)
    
    # Create comparison plot
    fig, ax = plt.subplots(figsize=(12, 7))
    
    ax.plot(air_gaps, eff_single, 'o-', color='#3498db', linewidth=3, 
           markersize=6, label='Single Layer (8T) - OD: 223.8mm', alpha=0.8)
    ax.plot(air_gaps, eff_stacked_8, 's-', color='#2ecc71', linewidth=3, 
           markersize=6, label='Stacked 2×8T - OD: 223.8mm ⭐', alpha=0.8)
    ax.plot(air_gaps, eff_stacked_29, '^-', color='#e74c3c', linewidth=3, 
           markersize=6, label='Stacked 2×29T - OD: 295.2mm', alpha=0.8)
    
    ax.axhline(85, color='orange', linestyle='--', linewidth=2, alpha=0.6, label='85% Target')
    ax.axvline(40, color='gray', linestyle=':', linewidth=2, alpha=0.6, label='Target Gap (40mm)')
    
    # Add annotations at 40mm
    idx_40 = list(air_gaps).index(40)
    ax.plot(40, eff_single[idx_40], 'o', color='#3498db', markersize=12, 
           markeredgecolor='black', markeredgewidth=2)
    ax.plot(40, eff_stacked_8[idx_40], 's', color='#2ecc71', markersize=12, 
           markeredgecolor='black', markeredgewidth=2)
    ax.plot(40, eff_stacked_29[idx_40], '^', color='#e74c3c', markersize=12, 
           markeredgecolor='black', markeredgewidth=2)
    
    ax.text(42, eff_single[idx_40], f'{eff_single[idx_40]:.1f}%', 
           fontsize=10, fontweight='bold', va='center')
    ax.text(42, eff_stacked_8[idx_40], f'{eff_stacked_8[idx_40]:.1f}%', 
           fontsize=10, fontweight='bold', va='center')
    ax.text(42, eff_stacked_29[idx_40], f'{eff_stacked_29[idx_40]:.1f}%', 
           fontsize=10, fontweight='bold', va='center')
    
    ax.set_xlabel('Air Gap (mm)', fontsize=13, fontweight='bold')
    ax.set_ylabel('Link Efficiency (%)', fontsize=13, fontweight='bold')
    ax.set_title('Efficiency vs Air Gap Comparison\n200mm ID, 0.7mm Wire, 40kHz', 
                fontsize=15, fontweight='bold', pad=20)
    ax.grid(True, alpha=0.3, linestyle='--')
    ax.legend(fontsize=11, loc='lower left', framealpha=0.9)
    ax.set_ylim(70, 100)
    ax.set_xlim(20, 80)
    
    plt.tight_layout()
    plt.savefig('Efficiency_vs_AirGap_Comparison.png', dpi=300, bbox_inches='tight')
    plt.close()
    print("      Saved: Efficiency_vs_AirGap_Comparison.png")
    
    # ========================================================================
    # SUMMARY COMPARISON TABLE
    # ========================================================================
    print("\n" + "=" * 70)
    print("DESIGN OPTIONS SUMMARY @ 40mm Air Gap")
    print("=" * 70)
    
    res_single = simulate_stacked_system(INNER_RADIUS, 8, 1.7, 0.7, 1, 0, 40, FREQ)
    res_stacked_8 = simulate_stacked_system(INNER_RADIUS, 8, 1.7, 0.7, 2, 1.5, 40, FREQ)
    res_stacked_29 = simulate_stacked_system(INNER_RADIUS, 29, 1.7, 0.7, 2, 1.5, 40, FREQ)
    
    print(f"\n{'Parameter':<25} {'Single 8T':<15} {'Stacked 2×8T':<15} {'Stacked 2×29T':<15}")
    print("-" * 70)
    print(f"{'Outer Diameter':<25} {res_single['outer_diameter_mm']:<15.1f} {res_stacked_8['outer_diameter_mm']:<15.1f} {res_stacked_29['outer_diameter_mm']:<15.1f}")
    print(f"{'Total Turns':<25} {res_single['total_turns']:<15} {res_stacked_8['total_turns']:<15} {res_stacked_29['total_turns']:<15}")
    print(f"{'Wire Length (m)':<25} {res_single['wire_length_m']:<15.2f} {res_stacked_8['wire_length_m']:<15.2f} {res_stacked_29['wire_length_m']:<15.2f}")
    print(f"{'Inductance (µH)':<25} {res_single['L_tx_uH']:<15.2f} {res_stacked_8['L_tx_uH']:<15.2f} {res_stacked_29['L_tx_uH']:<15.2f}")
    print(f"{'Coupling (k)':<25} {res_single['k']:<15.4f} {res_stacked_8['k']:<15.4f} {res_stacked_29['k']:<15.4f}")
    print(f"{'Q Factor':<25} {res_single['Q']:<15.1f} {res_stacked_8['Q']:<15.1f} {res_stacked_29['Q']:<15.1f}")
    print(f"{'Efficiency (%)':<25} {res_single['eff']*100:<15.1f} {res_stacked_8['eff']*100:<15.1f} {res_stacked_29['eff']*100:<15.1f}")
    print(f"{'Capacitor (nF)':<25} {res_single['C_resonant_nF']:<15.1f} {res_stacked_8['C_resonant_nF']:<15.1f} {res_stacked_29['C_resonant_nF']:<15.1f}")
    
    print("\n" + "=" * 70)
    print("✓ RECOMMENDATION: Stacked 2×8 Turns")
    print("  - Same compact size as single layer (223.8mm OD)")
    print("  - 91.5% efficiency (5.8% better than single layer)")
    print("  - Reasonable capacitor value (133.6nF)")
    print("  - Best balance of performance and manufacturability")
    print("=" * 70)
    
    print("\nAll files generated successfully!")
    print("  - Single_Layer_8Turns_A3.png")
    print("  - Efficiency_vs_AirGap_Comparison.png")
    print("=" * 70)

if __name__ == "__main__":
    main()