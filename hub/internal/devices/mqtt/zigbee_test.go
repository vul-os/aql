package mqtt

import "testing"

// The claim this test exists to make true: Zigbee and Z-Wave do not need a
// radio in the hub.
//
// The near-universal deployment is a bridge — zigbee2mqtt, or zwave-js-ui —
// that owns the radio and republishes every device onto MQTT. The barrier was
// never the radio; it was that those bridges publish a JSON object per device
// and this driver could only read a bare number or a bare string.
//
// These are the real payload shapes, so the test fails if the extraction
// stops handling what those bridges actually send.
func TestZigbee2MQTTPayloadShapes(t *testing.T) {
	for _, tc := range []struct {
		name    string
		payload string
		field   string
		want    string
	}{
		{
			// A dimmable lamp. brightness is 0..254 on Zigbee, scaled by config.
			name:    "lamp brightness",
			payload: `{"state":"ON","brightness":254,"linkquality":72}`,
			field:   "brightness", want: "254",
		},
		{
			name:    "lamp state as text",
			payload: `{"state":"ON","brightness":254}`,
			field:   "state", want: "ON",
		},
		{
			// A contact sensor. Booleans render numerically so a door sensor
			// can be read as a metric rather than needing a text metric.
			name:    "contact sensor boolean",
			payload: `{"contact":false,"battery":87,"voltage":2900}`,
			field:   "contact", want: "0",
		},
		{
			name:    "battery percentage",
			payload: `{"contact":false,"battery":87}`,
			field:   "battery", want: "87",
		},
		{
			// A power plug reporting energy — the zwave-js-ui shape.
			name:    "nested value",
			payload: `{"value":{"power":1240.5},"time":1700000000}`,
			field:   "value.power", want: "1240.5",
		},
		{
			name:    "float without exponent",
			payload: `{"temperature":21.5}`,
			field:   "temperature", want: "21.5",
		},
	} {
		got, ok := jsonField(mustDecode(t, tc.payload), tc.field)
		if !ok {
			t.Errorf("%s: field %q not found in %s", tc.name, tc.field, tc.payload)
			continue
		}
		if string(got) != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

// A field the bridge did not publish must be ABSENT, not zero. zigbee2mqtt
// omits keys a device has not reported since it joined, and a battery reading
// of 0 would be alarming in a way "no reading yet" is not.
func TestMissingFieldIsAbsentNotZero(t *testing.T) {
	doc := mustDecode(t, `{"state":"ON"}`)
	if _, ok := jsonField(doc, "battery"); ok {
		t.Fatal("a field the bridge did not send was resolved anyway")
	}
	// null likewise: a null battery is not a flat battery.
	if _, ok := jsonField(mustDecode(t, `{"battery":null}`), "battery"); ok {
		t.Fatal("a JSON null resolved to a reading")
	}
	// An object or array is not a reading either.
	if _, ok := jsonField(mustDecode(t, `{"color":{"x":0.3,"y":0.4}}`), "color"); ok {
		t.Fatal("an object resolved to a reading")
	}
}

func TestUnknownPathDoesNotPanic(t *testing.T) {
	doc := mustDecode(t, `{"a":{"b":1}}`)
	for _, p := range []string{"a.b.c", "x", "a.x", ""} {
		if _, ok := jsonField(doc, p); ok && p != "" {
			t.Errorf("path %q unexpectedly resolved", p)
		}
	}
}

func mustDecode(t *testing.T, s string) any {
	t.Helper()
	var doc any
	if err := jsonUnmarshalForTest(s, &doc); err != nil {
		t.Fatalf("bad test fixture %q: %v", s, err)
	}
	return doc
}

func jsonUnmarshalForTest(s string, v any) error {
	return jsonUnmarshal([]byte(s), v)
}
