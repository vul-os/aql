import numpy as np

def ellipk(k):
    """Complete Elliptic Integral of the First Kind K(k) using AGM."""
    a, b = 1.0, np.sqrt(1 - k**2)
    while np.abs(a - b) > 1e-9:
        a, b = (a + b) / 2, np.sqrt(a * b)
    return np.pi / (2 * a)

def ellipe(k):
    """Complete Elliptic Integral of the Second Kind E(k)."""
    theta = np.linspace(0, np.pi/2, 1000)
    return np.trapz(np.sqrt(1 - k**2 * np.sin(theta)**2), theta)

def mutual_loops(r1, r2, z):
    """Exact Mutual Inductance between two coaxial circular loops (Maxwell)."""
    if r1 <= 0 or r2 <= 0: return 0
    mu0 = 4 * np.pi * 1e-7
    k_sq = 4 * r1 * r2 / ((r1 + r2)**2 + z**2)
    k = np.sqrt(k_sq)
    if k >= 1.0: k = 0.99999999
    K, E = ellipk(k), ellipe(k)
    return mu0 * np.sqrt(r1 * r2) * ((2/k - k)*K - (2/k)*E)

def mutual_parallel_segments(l, m, d, h):
    """
    Mutual inductance between two parallel filaments.
    l, m: lengths of segments
    d: distance between lines
    h: longitudinal offset
    """
    if d <= 0: return 0
    mu0 = 4 * np.pi * 1e-7
    def f(x):
        return x * np.arcsinh(x/d) - np.sqrt(x**2 + d**2)
    val = f(l + h) - f(h) - f(l - m + h) + f(h - m)
    return (mu0 / (4 * np.pi)) * val

def get_coil_geometry(width, height, pitch, shape='square'):
    n_turns = int(min(width, height) / (2 * pitch))
    turns = []
    if shape == 'circle':
        for i in range(n_turns):
            r = (width / 2) - i * pitch
            if r > 0: turns.append(r / 1000.0)
    else:
        for i in range(n_turns):
            w = (width - 2 * i * pitch) / 1000.0
            h = (height - 2 * i * pitch) / 1000.0
            if w > 0 and h > 0:
                turns.append((w/2, h/2)) # Store half-dimensions
    return turns

def calculate_self_inductance(turns, wire_dia_mm, shape='square'):
    L = 0
    wire_r = (wire_dia_mm / 2) / 1000.0
    mu0 = 4 * np.pi * 1e-7

    if shape == 'circle':
        for i, r1 in enumerate(turns):
            L += r1 * mu0 * (np.log(8 * r1 / wire_r) - 2)
            for j, r2 in enumerate(turns):
                if i != j: L += mutual_loops(r1, r2, 0)
    else:
        # Sum all segment-to-segment interactions within the coil
        for i, (w1, h1) in enumerate(turns):
            # Self of 4 segments
            L += (mu0/np.pi) * (w1 * np.log(2*w1/wire_r) + h1 * np.log(2*h1/wire_r))
            # Internal mutuals
            for j, (w2, h2) in enumerate(turns):
                # We calculate mutual between rectangle i and rectangle j
                # Vertical-Vertical
                dist_near = abs(w1 - w2)
                dist_far = abs(w1 + w2)
                if i == j: dist_near = wire_r # use wire radius for self-interaction
                
                # Near-Near (+) and Far-Far (+)
                m_vv = 2 * mutual_parallel_segments(2*h1, 2*h2, dist_near, 0)
                # Near-Far (-) and Far-Near (-)
                m_vv -= 2 * mutual_parallel_segments(2*h1, 2*h2, dist_far, 0)
                
                # Horizontal-Horizontal
                dist_near_h = abs(h1 - h2)
                dist_far_h = abs(h1 + h2)
                if i == j: dist_near_h = wire_r
                
                m_hh = 2 * mutual_parallel_segments(2*w1, 2*w2, dist_near_h, 0)
                m_hh -= 2 * mutual_parallel_segments(2*w1, 2*w2, dist_far_h, 0)
                
                if i == j:
                    # For self-inductance of the same turn, we only add the mutual parts
                    # (The self-inductance of the segments is already added above)
                    L += (m_vv + m_hh) - (mu0/np.pi)*(w1*np.log(2*w1/wire_r) + h1*np.log(2*h1/wire_r)) # remove double count
                else:
                    L += (m_vv + m_hh)
    return L

def calculate_mutual_inductance_rigorous(turns1, turns2, gap_mm, shape='square'):
    M = 0
    z = gap_mm / 1000.0
    if shape == 'circle':
        for r1 in turns1:
            for r2 in turns2:
                M += mutual_loops(r1, r2, z)
    else:
        for (w1, h1) in turns1:
            for (w2, h2) in turns2:
                # Vertical segments interaction
                # dist = sqrt(delta_x^2 + delta_z^2)
                d_near = np.sqrt((w1 - w2)**2 + z**2)
                d_far = np.sqrt((w1 + w2)**2 + z**2)
                
                # (Left1, Left2) + (Right1, Right2) -> Positive
                m_vv = 2 * mutual_parallel_segments(2*h1, 2*h2, d_near, 0)
                # (Left1, Right2) + (Right1, Left2) -> Negative
                m_vv -= 2 * mutual_parallel_segments(2*h1, 2*h2, d_far, 0)
                
                # Horizontal segments interaction
                d_near_h = np.sqrt((h1 - h2)**2 + z**2)
                d_far_h = np.sqrt((h1 + h2)**2 + z**2)
                
                m_hh = 2 * mutual_parallel_segments(2*w1, 2*w2, d_near_h, 0)
                m_hh -= 2 * mutual_parallel_segments(2*w1, 2*w2, d_far_h, 0)
                
                M += (m_vv + m_hh)
    return M

def calculate_ac_resistance(turns, wire_dia_mm, pitch_mm, freq, shape='square', litz_factor=1.0):
    rho = 1.68e-8
    mu0 = 4 * np.pi * 1e-7
    omega = 2 * np.pi * freq
    skin_depth = np.sqrt(2 * rho / (omega * mu0))
    wire_r = (wire_dia_mm / 2) / 1000.0
    
    if shape == 'circle':
        length = sum(2 * np.pi * r for r in turns)
    else:
        length = sum(4 * (w + h) for w, h in turns)
        
    r_dc = rho * length / (np.pi * wire_r**2)
    
    if skin_depth < wire_r:
        r_ac = r_dc * (wire_r / (2 * skin_depth) + 0.25)
    else:
        r_ac = r_dc
        
    # Proximity Effect
    n = len(turns)
    eta = wire_dia_mm / pitch_mm
    prox_factor = 1 + ( (n**2 - 1)/3 ) * (eta**2) * ( (wire_r/skin_depth)**4 / 400) 
    
    # Litz wire reduces AC resistance significantly
    # litz_factor = 1.0 (standard), < 1.0 (litz)
    return r_ac * min(prox_factor, 15) * litz_factor

def calculate_total_system_efficiency(link_eff, v_in, p_load=25.0):
    if link_eff <= 0: return 0
    V_diode = 0.5
    R_driver = 0.2
    I_load = p_load / v_in
    P_rectifier_loss = 2 * V_diode * I_load
    P_coil_out_needed = p_load + P_rectifier_loss
    P_coil_in_needed = P_coil_out_needed / link_eff
    I_in = P_coil_in_needed / v_in
    P_driver_loss = (I_in**2) * R_driver
    P_source = P_coil_in_needed + P_driver_loss
    return p_load / P_source

def simulate_system(width, height, pitch, wire_dia, gap_mm, freq=40000, shape='square', ferrite_factor=1.0, litz_factor=1.0):
    turns = get_coil_geometry(width, height, pitch, shape)
    if not turns: return None
    
    # Ferrite increases L and M
    L = calculate_self_inductance(turns, wire_dia, shape) * ferrite_factor
    M = calculate_mutual_inductance_rigorous(turns, turns, gap_mm, shape) * ferrite_factor
    R_ac = calculate_ac_resistance(turns, wire_dia, pitch, freq, shape, litz_factor)
    
    w = 2 * np.pi * freq
    Q = (w * L) / R_ac
    k = M / L
    U = k * Q
    eff = (U**2) / (1 + np.sqrt(1 + U**2))**2
    
    return {
        "width": width, "height": height, "pitch": pitch, "wire_dia": wire_dia,
        "L_uH": L * 1e6, "R_ac": R_ac, "Q": Q, "k": k, "eff": eff, "U": U,
        "n_turns": len(turns), "shape": shape
    }

def simulate_asymmetric_system(w1, h1, p1, wd1, w2, h2, p2, wd2, gap_mm, freq=40000, shape1='square', shape2='square'):
    turns1 = get_coil_geometry(w1, h1, p1, shape1)
    turns2 = get_coil_geometry(w2, h2, p2, shape2)
    L1 = calculate_self_inductance(turns1, wd1, shape1)
    L2 = calculate_self_inductance(turns2, wd2, shape2)
    M = calculate_mutual_inductance_rigorous(turns1, turns2, gap_mm, shape1)
    R1 = calculate_ac_resistance(turns1, wd1, p1, freq, shape1)
    R2 = calculate_ac_resistance(turns2, wd2, p2, freq, shape2)
    w = 2 * np.pi * freq
    Q1, Q2 = (w * L1) / R1, (w * L2) / R2
    k = M / np.sqrt(L1 * L2)
    U = k * np.sqrt(Q1 * Q2)
    link_eff = (U**2) / (1 + np.sqrt(1 + U**2))**2
    return {"link_eff": link_eff, "k": k, "U": U, "Q1": Q1, "Q2": Q2}

def optimize_specific_size(width, height, target_gap_mm=35, freq=40000, shape='square', ferrite_factor=1.0, litz_factor=1.0):
    results = []
    wire_dias = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0]
    for wd in wire_dias:
        # Try more turns (smaller pitch) and fewer turns (larger pitch)
        pitches = np.linspace(wd + 0.1, wd * 5, 8)
        for p in pitches:
            res = simulate_system(width, height, p, wd, target_gap_mm, freq, shape, ferrite_factor, litz_factor)
            if res:
                res['total_eff'] = calculate_total_system_efficiency(res['eff'], 12.0, 25.0)
                results.append(res)
    results.sort(key=lambda x: x['total_eff'], reverse=True)
    return results[0] if results else None

# ============================================================================
# STACKED COIL FUNCTIONS
# ============================================================================

def generate_stacked_coil_geometry(inner_radius_mm, turns_per_layer, pitch_mm, num_layers, layer_gap_mm):
    """
    Generate 3D geometry for a stacked circular coil.
    
    Args:
        inner_radius_mm: Inner radius in mm (e.g., 100mm for 200mm ID)
        turns_per_layer: Number of turns in each layer
        pitch_mm: Radial pitch between turns
        num_layers: Number of stacked layers
        layer_gap_mm: Vertical gap between layers
    
    Returns:
        List of (radius_m, z_m) tuples representing each turn's position
    """
    turns_3d = []
    
    for layer_idx in range(num_layers):
        z_position = layer_idx * layer_gap_mm / 1000.0  # Convert to meters
        
        for turn_idx in range(turns_per_layer):
            radius = (inner_radius_mm + turn_idx * pitch_mm) / 1000.0  # Convert to meters
            turns_3d.append((radius, z_position))
    
    return turns_3d

def calculate_self_inductance_stacked(turns_3d, wire_dia_mm):
    """
    Calculate self-inductance for a 3D stacked coil configuration.
    
    Args:
        turns_3d: List of (radius_m, z_m) tuples
        wire_dia_mm: Wire diameter in mm
    
    Returns:
        Self-inductance in Henries
    """
    L = 0
    wire_r = (wire_dia_mm / 2) / 1000.0
    mu0 = 4 * np.pi * 1e-7
    
    for i, (r1, z1) in enumerate(turns_3d):
        # Self-inductance of single loop
        if r1 > 0:
            L += r1 * mu0 * (np.log(8 * r1 / wire_r) - 2)
        
        # Mutual inductance with all other loops
        for j, (r2, z2) in enumerate(turns_3d):
            if i != j:
                z_diff = abs(z1 - z2)
                L += mutual_loops(r1, r2, z_diff)
    
    return L

def calculate_mutual_inductance_stacked(turns_tx_3d, turns_rx_3d, air_gap_mm):
    """
    Calculate mutual inductance between two stacked coil configurations.
    
    Args:
        turns_tx_3d: List of (radius_m, z_m) for TX coil
        turns_rx_3d: List of (radius_m, z_m) for RX coil
        air_gap_mm: Air gap between TX and RX in mm
    
    Returns:
        Mutual inductance in Henries
    """
    M = 0
    air_gap_m = air_gap_mm / 1000.0
    
    # Sum mutual inductance between every TX turn and every RX turn
    for (r_tx, z_tx) in turns_tx_3d:
        for (r_rx, z_rx) in turns_rx_3d:
            # Total vertical distance = air_gap + z_rx - z_tx
            # (z_tx starts at 0, z_rx starts at air_gap)
            z_total = air_gap_m + z_rx - z_tx
            M += mutual_loops(r_tx, r_rx, z_total)
    
    return M

def simulate_stacked_system(inner_radius_mm, turns_per_layer, pitch_mm, wire_dia_mm, 
                           num_layers, layer_gap_mm, air_gap_mm, freq=40000):
    """
    Simulate a stacked coil WPT system.
    
    Args:
        inner_radius_mm: Inner radius (100mm for 200mm ID)
        turns_per_layer: Number of turns per layer
        pitch_mm: Radial pitch between turns
        wire_dia_mm: Wire diameter
        num_layers: Number of layers (e.g., 2 for double-layer)
        layer_gap_mm: Gap between stacked layers
        air_gap_mm: Air gap between TX and RX
        freq: Operating frequency in Hz
    
    Returns:
        Dictionary with simulation results
    """
    # Generate TX coil geometry
    turns_tx = generate_stacked_coil_geometry(
        inner_radius_mm, turns_per_layer, pitch_mm, num_layers, layer_gap_mm
    )
    
    # Generate RX coil geometry (same as TX)
    turns_rx = generate_stacked_coil_geometry(
        inner_radius_mm, turns_per_layer, pitch_mm, num_layers, layer_gap_mm
    )
    
    # Calculate inductances
    L_tx = calculate_self_inductance_stacked(turns_tx, wire_dia_mm)
    L_rx = calculate_self_inductance_stacked(turns_rx, wire_dia_mm)
    M = calculate_mutual_inductance_stacked(turns_tx, turns_rx, air_gap_mm)
    
    # Calculate total wire length for resistance
    total_wire_length = 0
    for (r, z) in turns_tx:
        total_wire_length += 2 * np.pi * r
    
    # Calculate AC resistance
    rho = 1.68e-8  # Copper resistivity
    mu0 = 4 * np.pi * 1e-7
    omega = 2 * np.pi * freq
    skin_depth = np.sqrt(2 * rho / (omega * mu0))
    wire_r = (wire_dia_mm / 2) / 1000.0
    
    r_dc = rho * total_wire_length / (np.pi * wire_r**2)
    
    if skin_depth < wire_r:
        r_ac = r_dc * (wire_r / (2 * skin_depth) + 0.25)
    else:
        r_ac = r_dc
    
    # Proximity effect for stacked coils
    total_turns = len(turns_tx)
    eta = wire_dia_mm / pitch_mm
    prox_factor = 1 + ((total_turns**2 - 1)/3) * (eta**2) * ((wire_r/skin_depth)**4 / 400)
    # Add inter-layer proximity effect
    if num_layers > 1:
        layer_eta = wire_dia_mm / layer_gap_mm
        prox_factor *= (1 + 0.5 * layer_eta**2)
    
    R_ac = r_ac * min(prox_factor, 20)
    
    # Calculate performance metrics
    w = 2 * np.pi * freq
    Q = (w * L_tx) / R_ac
    k = M / L_tx  # Assuming symmetric system
    U = k * Q
    eff = (U**2) / (1 + np.sqrt(1 + U**2))**2
    
    # Calculate outer diameter
    outer_radius_mm = inner_radius_mm + (turns_per_layer - 1) * pitch_mm
    outer_diameter_mm = 2 * outer_radius_mm
    inner_diameter_mm = 2 * inner_radius_mm
    
    # Calculate resonant capacitance for target frequency
    C_resonant = 1 / (4 * np.pi**2 * freq**2 * L_tx)
    
    return {
        "inner_diameter_mm": inner_diameter_mm,
        "outer_diameter_mm": outer_diameter_mm,
        "turns_per_layer": turns_per_layer,
        "num_layers": num_layers,
        "total_turns": total_turns,
        "layer_gap_mm": layer_gap_mm,
        "air_gap_mm": air_gap_mm,
        "wire_dia_mm": wire_dia_mm,
        "pitch_mm": pitch_mm,
        "L_tx_uH": L_tx * 1e6,
        "L_rx_uH": L_rx * 1e6,
        "M_uH": M * 1e6,
        "R_ac_ohm": R_ac,
        "Q": Q,
        "k": k,
        "U": U,
        "eff": eff,
        "wire_length_m": total_wire_length,
        "C_resonant_nF": C_resonant * 1e9,
        "freq_Hz": freq
    }

def optimize_stacked_coil(inner_radius_mm, num_layers, layer_gap_mm, target_air_gap_mm, freq=40000):
    """
    Optimize stacked coil design for best efficiency.
    
    Args:
        inner_radius_mm: Inner radius (100mm for 200mm ID)
        num_layers: Number of stacked layers
        layer_gap_mm: Gap between layers
        target_air_gap_mm: Target air gap
        freq: Operating frequency
    
    Returns:
        Best design parameters
    """
    results = []
    
    # Try different wire diameters and turns per layer
    wire_diameters = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2]
    turns_options = [8, 10, 12, 15, 18, 20, 25, 29]
    
    for wire_dia in wire_diameters:
        for turns in turns_options:
            # Calculate pitch based on wire diameter
            pitch = wire_dia + 1.0  # 1mm gap
            
            # Check if it fits within reasonable OD (e.g., max 300mm)
            outer_radius = inner_radius_mm + (turns - 1) * pitch
            if outer_radius > 150:  # Max 300mm OD
                continue
            
            try:
                res = simulate_stacked_system(
                    inner_radius_mm, turns, pitch, wire_dia,
                    num_layers, layer_gap_mm, target_air_gap_mm, freq
                )
                
                # Calculate total system efficiency
                total_eff = calculate_total_system_efficiency(res['eff'], 12.0, 25.0)
                res['total_eff'] = total_eff
                results.append(res)
            except:
                continue
    
    # Sort by total efficiency
    results.sort(key=lambda x: x['total_eff'], reverse=True)
    return results[0] if results else None

def generate_fixed_spiral(width, height, pitch, shape='square'):
    turns = get_coil_geometry(width, height, pitch, shape)
    if shape == 'circle':
        theta = np.linspace(0, 2*np.pi*len(turns), 1000)
        r = np.linspace(width/2, width/2 - len(turns)*pitch, 1000)
        return r * np.cos(theta), r * np.sin(theta), sum(2*np.pi*r for r in turns)
    else:
        x, y = [width/2], [height/2]
        for i in range(len(turns)):
            w, h = (width - 2*i*pitch), (height - 2*i*pitch)
            x.extend([x[-1]-w, x[-1], x[-1]+w, x[-1]])
            y.extend([y[-1], y[-1]-h, y[-1], y[-1]+h])
        return np.array(x), np.array(y), sum(4*(w+h) for w,h in turns)
