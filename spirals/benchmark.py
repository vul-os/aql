import matplotlib.pyplot as plt
import numpy as np
import matplotlib
from physics import (
    simulate_system, 
    calculate_total_system_efficiency, 
    optimize_specific_size,
    generate_fixed_spiral,
    simulate_asymmetric_system,
    calculate_self_inductance,
    get_coil_geometry
)

matplotlib.use('Agg')

def save_final_template(width, height, pitch, name, color, target_cap_uf=0.68, shape='square'):
    x, y, length_mm = generate_fixed_spiral(width, height, pitch, shape=shape)
    turns = get_coil_geometry(width, height, pitch, shape=shape)
    L = calculate_self_inductance(turns, 0.1, shape=shape) # Use small wire dia for L calc
    L_uH = L * 1e6
    n_turns = len(turns)
    
    freq = 1 / (2 * np.pi * np.sqrt(L_uH * 1e-6 * target_cap_uf * 1e-6))
    
    a4_w, a4_h = 210, 297
    fig = plt.figure(figsize=(8.27, 11.69))
    ax = fig.add_axes([0.1, 0.15, 0.8, 0.7]) 
    
    ax.plot(x, y, color=color, linewidth=2.5, zorder=2)
    ax.scatter([x[0]], [y[0]], color='green', s=100, label="START")
    ax.scatter([0], [0], color='black', s=150, zorder=3)
    
    ax.axhline(0, color='black', lw=0.5, ls='--')
    ax.axvline(0, color='black', lw=0.5, ls='--')

    spec_text = (
        f"--- {name} ---\n"
        f"Size: {width}x{height}mm | Pitch: {pitch:.2f}mm\n"
        f"Turns: {n_turns:.1f} | L: {L_uH:.2f} uH\n"
        f"Wire Len: {length_mm/1000:.2f}m\n"
        f"Freq w/ {target_cap_uf}uF: {freq/1000:.2f} kHz"
    )
    
    fig.text(0.5, 0.1, spec_text, ha='center', va='center', fontsize=12, 
             family='monospace', fontweight='bold', 
             bbox=dict(boxstyle='round,pad=1', facecolor='#f0f0f0', edgecolor='black'))

    ax.set_xlim(-a4_w/2, a4_w/2)
    ax.set_ylim(-a4_h/2, a4_h/2)
    ax.set_aspect('equal')
    ax.axis('off')
    
    plt.savefig(f"{name}_A4.png", dpi=300)
    plt.close()

def save_circular_coil_template(od_mm, id_mm, pitch, num_turns, name, target_cap_uf=0.68):
    """
    Generate a circular spiral coil template visualization on A3 paper.
    
    Args:
        od_mm: Outer diameter in mm
        id_mm: Inner diameter in mm
        pitch: Pitch spacing in mm
        num_turns: Number of turns
        name: Name for the output file
        target_cap_uf: Target capacitance in microfarads
    """
    # Calculate inductance (approximate for circular coil)
    # Using Wheeler's formula for flat spiral coils
    avg_radius_mm = (od_mm + id_mm) / 4  # Average radius
    avg_radius_m = avg_radius_mm / 1000
    
    # Wheeler's formula: L (uH) ≈ (r^2 * n^2) / (8*r + 11*w)
    # where r is average radius, n is turns, w is radial width
    radial_width_mm = (od_mm - id_mm) / 2
    radial_width_m = radial_width_mm / 1000
    
    L_uH = (avg_radius_m**2 * num_turns**2) / (8*avg_radius_m + 11*radial_width_m) * 1e6
    
    # Calculate wire length
    wire_length_m = 0
    for turn in range(num_turns):
        radius = id_mm/2 + turn * pitch
        wire_length_m += 2 * np.pi * radius / 1000
    
    # Calculate resonant frequency
    freq = 1 / (2 * np.pi * np.sqrt(L_uH * 1e-6 * target_cap_uf * 1e-6))
    
    # Create the visualization - A3 size (297mm x 420mm)
    a3_w, a3_h = 297, 420
    fig = plt.figure(figsize=(11.69, 16.54))  # A3 in inches
    ax = fig.add_axes([0.1, 0.2, 0.8, 0.65])
    
    # Draw individual turn circles for clarity
    for turn in range(num_turns):
        radius = id_mm/2 + turn * pitch
        circle = plt.Circle((0, 0), radius, fill=False, color='green', 
                           linewidth=1.5, alpha=0.8, zorder=2)
        ax.add_patch(circle)
    
    # Highlight first and last turns
    first_radius = id_mm/2
    last_radius = id_mm/2 + (num_turns - 1) * pitch
    
    circle_first = plt.Circle((0, 0), first_radius, fill=False, color='red', 
                             linewidth=2.5, linestyle='-', label='Start (Inner)', zorder=3)
    circle_last = plt.Circle((0, 0), last_radius, fill=False, color='blue', 
                            linewidth=2.5, linestyle='-', label='End (Outer)', zorder=3)
    ax.add_patch(circle_first)
    ax.add_patch(circle_last)
    
    # Draw reference circles for OD and ID boundaries
    circle_od_ref = plt.Circle((0, 0), od_mm/2, fill=False, color='gray', 
                               linestyle='--', linewidth=1, alpha=0.4, label='OD Boundary')
    circle_id_ref = plt.Circle((0, 0), id_mm/2, fill=False, color='gray', 
                               linestyle='--', linewidth=1, alpha=0.4, label='ID Boundary')
    ax.add_patch(circle_od_ref)
    ax.add_patch(circle_id_ref)
    
    # Mark start point on inner circle
    start_x = first_radius
    start_y = 0
    ax.scatter([start_x], [start_y], color='red', s=200, marker='o', 
              edgecolors='black', linewidths=2, zorder=5, label='Connection Point')
    
    # Mark center
    ax.scatter([0], [0], color='black', s=150, zorder=4, marker='+', linewidths=3)
    
    # Add dimension lines and annotations
    # OD dimension line
    ax.plot([-od_mm/2, od_mm/2], [0, 0], 'k-', linewidth=1, alpha=0.5)
    ax.annotate('', xy=(od_mm/2, 0), xytext=(-od_mm/2, 0),
                arrowprops=dict(arrowstyle='<->', color='black', lw=1.5))
    ax.text(0, -15, f'OD = {od_mm}mm', ha='center', va='top', 
           fontsize=11, fontweight='bold', bbox=dict(boxstyle='round,pad=0.5', 
           facecolor='white', edgecolor='black'))
    
    # ID dimension line
    ax.plot([-id_mm/2, id_mm/2], [0, 0], 'r-', linewidth=1.5, alpha=0.7)
    ax.text(0, 10, f'ID = {id_mm}mm', ha='center', va='bottom', 
           fontsize=10, fontweight='bold', color='red')
    
    # Pitch annotation
    if num_turns > 1:
        r1 = id_mm/2
        r2 = id_mm/2 + pitch
        ax.plot([0, 0], [r1, r2], 'g-', linewidth=2, alpha=0.7)
        ax.annotate('', xy=(0, r2), xytext=(0, r1),
                    arrowprops=dict(arrowstyle='<->', color='green', lw=1.5))
        ax.text(5, (r1 + r2)/2, f'Pitch\n{pitch:.2f}mm', ha='left', va='center',
               fontsize=9, fontweight='bold', color='green',
               bbox=dict(boxstyle='round,pad=0.3', facecolor='white', 
               edgecolor='green', alpha=0.8))
    
    # Add crosshairs
    max_dim = max(a3_w, a3_h) / 2
    ax.axhline(0, color='black', lw=0.5, ls=':', alpha=0.3)
    ax.axvline(0, color='black', lw=0.5, ls=':', alpha=0.3)
    
    # Add grid for reference
    ax.grid(True, alpha=0.2, linestyle='--', linewidth=0.5)
    
    # Title
    ax.set_title(f'{name}\nPlanar Circular Spiral Coil Design', 
                fontsize=16, fontweight='bold', pad=20)
    
    # Specifications text box
    spec_text = (
        f"COIL SPECIFICATIONS\n"
        f"{'='*50}\n"
        f"Outer Diameter (OD):  {od_mm} mm\n"
        f"Inner Diameter (ID):  {id_mm} mm\n"
        f"Radial Width:         {radial_width_mm} mm\n"
        f"Wire Pitch:           {pitch:.2f} mm\n"
        f"Number of Turns:      {num_turns}\n"
        f"Total Wire Length:    {wire_length_m:.2f} m\n"
        f"Inductance (calc):    {L_uH:.2f} µH\n"
        f"Resonant Freq:        {freq/1000:.2f} kHz (with {target_cap_uf}µF)\n"
        f"{'='*50}\n"
        f"Scale: 1:1 (Actual Size)"
    )
    
    fig.text(0.5, 0.08, spec_text, ha='center', va='center', fontsize=10,
             family='monospace', fontweight='normal',
             bbox=dict(boxstyle='round,pad=1', facecolor='#f8f8f8', 
             edgecolor='black', linewidth=2))
    
    # Legend
    ax.legend(loc='upper right', fontsize=9, framealpha=0.9)
    
    ax.set_xlim(-a3_w/2, a3_w/2)
    ax.set_ylim(-a3_h/2, a3_h/2)
    ax.set_aspect('equal')
    ax.set_xlabel('Distance (mm)', fontsize=10)
    ax.set_ylabel('Distance (mm)', fontsize=10)
    
    plt.savefig(f"{name}_A3.png", dpi=300, bbox_inches='tight')
    plt.close()
    print(f"  Saved: {name}_A3.png")

def save_stacked_coil_template(inner_diameter_mm, outer_diameter_mm, turns_per_layer, 
                               num_layers, layer_gap_mm, pitch_mm, name):
    """
    Generate a stacked coil template visualization - top view with specifications.
    
    Args:
        inner_diameter_mm: Inner diameter
        outer_diameter_mm: Outer diameter
        turns_per_layer: Number of turns in each layer
        num_layers: Number of stacked layers
        layer_gap_mm: Gap between layers
        pitch_mm: Radial pitch
        name: Output filename
    """
    inner_radius = inner_diameter_mm / 2
    outer_radius = outer_diameter_mm / 2
    
    # Create A3 size figure
    a3_w, a3_h = 297, 420
    fig = plt.figure(figsize=(11.69, 16.54))  # A3 portrait
    ax = fig.add_axes([0.1, 0.25, 0.8, 0.6])
    
    # Draw all turns (all layers overlap in top view)
    for turn_idx in range(turns_per_layer):
        radius = inner_radius + turn_idx * pitch_mm
        circle = plt.Circle((0, 0), radius, fill=False, color='green', 
                           linewidth=1.5, alpha=0.8, zorder=2)
        ax.add_patch(circle)
    
    # Highlight first and last turns
    first_radius = inner_radius
    last_radius = inner_radius + (turns_per_layer - 1) * pitch_mm
    
    circle_first = plt.Circle((0, 0), first_radius, fill=False, color='red', 
                             linewidth=2.5, linestyle='-', label='Start (Inner)', zorder=3)
    circle_last = plt.Circle((0, 0), last_radius, fill=False, color='blue', 
                            linewidth=2.5, linestyle='-', label='End (Outer)', zorder=3)
    ax.add_patch(circle_first)
    ax.add_patch(circle_last)
    
    # Draw reference circles for OD and ID boundaries
    circle_od_ref = plt.Circle((0, 0), outer_radius, fill=False, color='gray', 
                               linestyle='--', linewidth=1, alpha=0.4, label='OD Boundary')
    circle_id_ref = plt.Circle((0, 0), inner_radius, fill=False, color='gray', 
                               linestyle='--', linewidth=1, alpha=0.4, label='ID Boundary')
    ax.add_patch(circle_od_ref)
    ax.add_patch(circle_id_ref)
    
    # Mark start point on inner circle
    start_x = first_radius
    start_y = 0
    ax.scatter([start_x], [start_y], color='red', s=200, marker='o', 
              edgecolors='black', linewidths=2, zorder=5, label='Connection Point')
    
    # Mark center
    ax.scatter([0], [0], color='black', s=150, zorder=4, marker='+', linewidths=3)
    
    # Add dimension lines and annotations
    # OD dimension line
    ax.plot([-outer_radius, outer_radius], [0, 0], 'k-', linewidth=1, alpha=0.5)
    ax.annotate('', xy=(outer_radius, 0), xytext=(-outer_radius, 0),
                arrowprops=dict(arrowstyle='<->', color='black', lw=1.5))
    ax.text(0, -15, f'OD = {outer_diameter_mm:.1f}mm', ha='center', va='top', 
           fontsize=11, fontweight='bold', bbox=dict(boxstyle='round,pad=0.5', 
           facecolor='white', edgecolor='black'))
    
    # ID dimension line
    ax.plot([-inner_radius, inner_radius], [0, 0], 'r-', linewidth=1.5, alpha=0.7)
    ax.text(0, 10, f'ID = {inner_diameter_mm:.1f}mm', ha='center', va='bottom', 
           fontsize=10, fontweight='bold', color='red')
    
    # Pitch annotation
    if turns_per_layer > 1:
        r1 = inner_radius
        r2 = inner_radius + pitch_mm
        ax.plot([0, 0], [r1, r2], 'g-', linewidth=2, alpha=0.7)
        ax.annotate('', xy=(0, r2), xytext=(0, r1),
                    arrowprops=dict(arrowstyle='<->', color='green', lw=1.5))
        ax.text(5, (r1 + r2)/2, f'Pitch\n{pitch_mm:.2f}mm', ha='left', va='center',
               fontsize=9, fontweight='bold', color='green',
               bbox=dict(boxstyle='round,pad=0.3', facecolor='white', 
               edgecolor='green', alpha=0.8))
    
    # Add crosshairs
    ax.axhline(0, color='black', lw=0.5, ls=':', alpha=0.3)
    ax.axvline(0, color='black', lw=0.5, ls=':', alpha=0.3)
    
    # Add grid for reference
    ax.grid(True, alpha=0.2, linestyle='--', linewidth=0.5)
    
    # Title
    total_height = (num_layers - 1) * layer_gap_mm
    ax.set_title(f'{name}\nStacked Planar Circular Coil Design\n{num_layers} Layers × {turns_per_layer} Turns/Layer (Total Height: {total_height:.1f}mm)', 
                fontsize=16, fontweight='bold', pad=20)
    
    # Specifications text box
    total_turns = num_layers * turns_per_layer
    spec_text = (
        f"STACKED COIL SPECIFICATIONS\n"
        f"{'='*60}\n"
        f"Configuration:        {num_layers} Layers × {turns_per_layer} Turns/Layer\n"
        f"Total Turns:          {total_turns}\n"
        f"Inner Diameter (ID):  {inner_diameter_mm:.1f} mm\n"
        f"Outer Diameter (OD):  {outer_diameter_mm:.1f} mm\n"
        f"Radial Width:         {(outer_diameter_mm - inner_diameter_mm)/2:.1f} mm\n"
        f"Wire Pitch:           {pitch_mm:.2f} mm\n"
        f"Layer Gap:            {layer_gap_mm} mm\n"
        f"Total Stack Height:   {total_height:.1f} mm\n"
        f"{'='*60}\n"
        f"Scale: 1:1 (Actual Size)\n"
        f"Note: All {num_layers} layers are series-connected"
    )
    
    fig.text(0.5, 0.08, spec_text, ha='center', va='center', fontsize=10,
             family='monospace', fontweight='normal',
             bbox=dict(boxstyle='round,pad=1', facecolor='#f8f8f8', 
             edgecolor='black', linewidth=2))
    
    # Legend
    ax.legend(loc='upper right', fontsize=9, framealpha=0.9)
    
    ax.set_xlim(-a3_w/2, a3_w/2)
    ax.set_ylim(-a3_h/2, a3_h/2)
    ax.set_aspect('equal')
    ax.set_xlabel('Distance (mm)', fontsize=10)
    ax.set_ylabel('Distance (mm)', fontsize=10)
    
    plt.savefig(f"{name}_A3.png", dpi=300, bbox_inches='tight')
    plt.close()
    print(f"  Saved: {name}_A3.png")


def sweep_efficiency_vs_gap(width, height, pitch, wire_dia, freq=40000, prefix=""):
    gaps = np.arange(5, 100, 2)
    effs = []
    for g in gaps:
        res = simulate_system(width, height, pitch, wire_dia, g, freq)
        effs.append(res['eff'] * 100)
        
    plt.figure(figsize=(10, 6))
    plt.plot(gaps, effs, marker='o', color='purple')
    plt.title(f"Efficiency vs Gap\nSize={width}x{height}mm, Wire={wire_dia}mm")
    plt.xlabel("Gap (mm)")
    plt.ylabel("Efficiency (%)")
    plt.grid(True)
    plt.ylim(0, 100)
    plt.savefig(f"{prefix}Efficiency_vs_Gap.png", dpi=300)
    plt.close()

def sweep_voltage_vs_efficiency(width, height, pitch, wire_dia, gap_mm, freq=40000, prefix=""):
    voltages = np.arange(6, 25, 1)
    effs = []
    res = simulate_system(width, height, pitch, wire_dia, gap_mm, freq)
    link_eff = res['eff']
    for v in voltages:
        total_eff = calculate_total_system_efficiency(link_eff, v, p_load=25.0)
        effs.append(total_eff * 100)
        
    plt.figure(figsize=(10, 6))
    plt.plot(voltages, effs, marker='s', color='orange')
    plt.title(f"Total Efficiency vs Input Voltage\nSize={width}x{height}mm, Gap={gap_mm}mm")
    plt.xlabel("Input Voltage (V)")
    plt.ylabel("Total Efficiency (%)")
    plt.grid(True)
    plt.ylim(0, 100)
    plt.savefig(f"{prefix}Voltage_vs_Efficiency.png", dpi=300)
    plt.close()

def sweep_frequency_vs_efficiency(width, height, pitch, wire_dia, gap_mm, operating_freq=None, prefix=""):
    freqs = np.arange(10000, 201000, 5000)
    effs = []
    for f in freqs:
        res = simulate_system(width, height, pitch, wire_dia, gap_mm, f)
        effs.append(res['eff'] * 100)
        
    plt.figure(figsize=(10, 6))
    plt.plot(freqs/1000, effs, marker='^', color='green', label='Link Efficiency')
    plt.title(f"Link Efficiency vs Frequency\nSize={width}x{height}mm, Gap={gap_mm}mm")
    plt.xlabel("Frequency (kHz)")
    plt.ylabel("Link Efficiency (%)")
    plt.grid(True)
    plt.ylim(0, 100)
    if operating_freq:
        plt.axvline(operating_freq/1000, color='blue', linestyle='--', label='Op. Point')
        plt.legend()
    plt.savefig(f"{prefix}Frequency_vs_Efficiency.png", dpi=300)
    plt.close()

def sweep_frequency_vs_tx_voltage(width, height, pitch, wire_dia, gap_mm, v_in=12.0, operating_freq=None, prefix=""):
    freqs = np.arange(10000, 201000, 5000)
    v_coils_loaded = []
    v_coils_noload = []
    v_ac_rms = (np.sqrt(2) / np.pi) * v_in
    
    for f in freqs:
        res = simulate_system(width, height, pitch, wire_dia, gap_mm, f)
        L = res['L_uH'] * 1e-6
        R_ac = res['R_ac']
        w = 2 * np.pi * f
        if R_ac > 0:
            q_unloaded = (w * L) / R_ac
            v_noload = q_unloaded * v_ac_rms
        else:
            v_noload = 0
        v_coils_noload.append(v_noload)
        
        eff = res['eff']
        if eff > 0:
            p_in_needed = 25.0 / eff
            i_tx = p_in_needed / v_ac_rms
            v_loaded = i_tx * w * L
        else:
            v_loaded = 0
        v_coils_loaded.append(v_loaded)
        
    plt.figure(figsize=(10, 6))
    plt.plot(freqs/1000, v_coils_noload, color='red', linestyle='--', label='No Load')
    plt.plot(freqs/1000, v_coils_loaded, color='blue', marker='d', label='25W Load')
    plt.title(f"TX Coil Voltage vs Frequency\nSize={width}x{height}mm, Gap={gap_mm}mm")
    plt.xlabel("Frequency (kHz)")
    plt.ylabel("TX Coil Voltage (V_rms)")
    plt.grid(True)
    if operating_freq:
        plt.axvline(operating_freq/1000, color='black', linestyle='-.', label='Op. Point')
    plt.legend()
    plt.savefig(f"{prefix}Frequency_vs_TX_Voltage.png", dpi=300)
    plt.close()

def sweep_efficiency_vs_gap_comparison(sizes, freq=40000):
    """
    sizes: list of (width, height) tuples
    """
    plt.figure(figsize=(10, 6))
    gaps = np.arange(5, 150, 5)
    for w, h in sizes:
        best = optimize_specific_size(w, h, target_gap_mm=35, freq=freq)
        if not best: continue
        effs = []
        for g in gaps:
            res = simulate_system(best['width'], best['height'], best['pitch'], best['wire_dia'], g, freq)
            total_eff = calculate_total_system_efficiency(res['eff'], v_in=12.0, p_load=25.0)
            effs.append(total_eff * 100)
        plt.plot(gaps, effs, label=f"{w}x{h}mm", linewidth=2)
        
    plt.title(f"Total Efficiency vs Gap Comparison\n(25W Load, 12V Input)")
    plt.xlabel("Gap (mm)")
    plt.ylabel("Total Efficiency (%)")
    plt.grid(True)
    plt.ylim(0, 100)
    plt.legend()
    plt.savefig("Efficiency_vs_Gap_Comparison.png", dpi=300)
    plt.close()

def sweep_rx_size_asymmetric(tx_size, rx_sizes, gap_mm=35, freq=40000):
    """
    tx_size: (w, h)
    rx_sizes: list of (w, h)
    """
    plt.figure(figsize=(10, 6))
    tx_opt = optimize_specific_size(tx_size[0], tx_size[1], gap_mm, freq)
    if not tx_opt: return

    effs = []
    x_labels = []
    for rx_w, rx_h in rx_sizes:
        rx_opt = optimize_specific_size(rx_w, rx_h, gap_mm, freq)
        if not rx_opt: continue
        res = simulate_asymmetric_system(
            tx_opt['width'], tx_opt['height'], tx_opt['pitch'], tx_opt['wire_dia'],
            rx_opt['width'], rx_opt['height'], rx_opt['pitch'], rx_opt['wire_dia'],
            gap_mm, freq
        )
        total_eff = calculate_total_system_efficiency(res['link_eff'], v_in=12.0, p_load=25.0)
        effs.append(total_eff * 100)
        x_labels.append(rx_w) # Using width as representative

    plt.plot(x_labels, effs, marker='o')
    plt.title(f"Asymmetric Efficiency vs RX Size\nTX={tx_size[0]}x{tx_size[1]}mm, Gap={gap_mm}mm")
    plt.xlabel("RX Width (mm)")
    plt.ylabel("Total Efficiency (%)")
    plt.grid(True)
    plt.ylim(0, 100)
    plt.savefig("Asymmetric_Efficiency_vs_RX_Size.png", dpi=300)
    plt.close()

def benchmark_rectangular_vs_square(target_area=14400, gap_mm=35, freq=40000):
    """
    Compares different aspect ratios for the same area.
    target_area: area in mm^2 (default 120x120 = 14400)
    """
    aspect_ratios = [0.25, 0.5, 1.0, 2.0, 4.0, 7.0, 8.0]
    plt.figure(figsize=(10, 6))
    
    gaps = np.arange(5, 100, 5)
    
    for ar in aspect_ratios:
        # w * h = area, w/h = ar => w = ar * h => ar * h^2 = area => h = sqrt(area/ar)
        h = np.sqrt(target_area / ar)
        w = ar * h
        
        best = optimize_specific_size(w, h, target_gap_mm=gap_mm, freq=freq)
        if not best: continue
        
        effs = []
        for g in gaps:
            res = simulate_system(best['width'], best['height'], best['pitch'], best['wire_dia'], g, freq)
            total_eff = calculate_total_system_efficiency(res['eff'], v_in=12.0, p_load=25.0)
            effs.append(total_eff * 100)
            
        plt.plot(gaps, effs, label=f"AR={ar:.2f} ({int(w)}x{int(h)}mm)")

    plt.title(f"Efficiency vs Gap: Aspect Ratio Comparison\n(Fixed Area={target_area}mm2, 25W Load)")
    plt.xlabel("Gap (mm)")
    plt.ylabel("Total Efficiency (%)")
    plt.grid(True)
    plt.ylim(0, 100)
    plt.legend()
    plt.savefig("Efficiency_vs_Gap_Aspect_Ratio.png", dpi=300)
    plt.close()
    print("Generated Efficiency_vs_Gap_Aspect_Ratio.png")

def benchmark_square_vs_circle(od=120, gap_mm=35, freq=40000):
    """
    Compares Square vs Circle coils of the same OD.
    """
    plt.figure(figsize=(10, 6))
    gaps = np.arange(5, 150, 5)
    
    shapes = ['square', 'circle']
    for s in shapes:
        best = optimize_specific_size(od, od, target_gap_mm=gap_mm, freq=freq, shape=s)
        if not best: continue
        
        effs = []
        for g in gaps:
            res = simulate_system(best['width'], best['height'], best['pitch'], best['wire_dia'], g, freq, shape=s)
            total_eff = calculate_total_system_efficiency(res['eff'], v_in=12.0, p_load=25.0)
            effs.append(total_eff * 100)
            
        plt.plot(gaps, effs, label=f"{s.capitalize()} (OD={od}mm)", linewidth=2)

    plt.title(f"Efficiency vs Gap: Square vs Circle Comparison\n(OD={od}mm, 25W Load, 12V Input)")
    plt.xlabel("Gap (mm)")
    plt.ylabel("Total Efficiency (%)")
    plt.grid(True)
    plt.ylim(0, 100)
    plt.legend()
    plt.savefig("Efficiency_vs_Gap_Square_vs_Circle.png", dpi=300)
    plt.close()
    print("Generated Efficiency_vs_Gap_Square_vs_Circle.png")

if __name__ == "__main__":
    # Example usage
    sizes = [(100, 100), (120, 120), (140, 140), (160, 160), (120, 160), (100, 200)]
    sweep_efficiency_vs_gap_comparison(sizes)
    benchmark_rectangular_vs_square(target_area=14400)
    
    # Run a full suite for a 120x120 coil
    best = optimize_specific_size(120, 120, target_gap_mm=35)
    if best:
        save_final_template(best['width'], best['height'], best['pitch'], "Best_120mm", "blue")
        sweep_efficiency_vs_gap(best['width'], best['height'], best['pitch'], best['wire_dia'])
        sweep_voltage_vs_efficiency(best['width'], best['height'], best['pitch'], best['wire_dia'], 35)
        sweep_frequency_vs_efficiency(best['width'], best['height'], best['pitch'], best['wire_dia'], 35)
        sweep_frequency_vs_tx_voltage(best['width'], best['height'], best['pitch'], best['wire_dia'], 35)
