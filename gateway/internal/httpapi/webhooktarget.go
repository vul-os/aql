package httpapi

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// Webhook target validation.
//
// This file exists because an outbound webhook is a request-forgery primitive
// handed to whoever can configure one. The hub sits INSIDE a home or office
// network, so a URL it will faithfully POST to reaches things nothing on the
// internet can: the router's admin page at 192.168.1.1, a printer, another
// hub, a NAS, a cloud instance's metadata service at 169.254.169.254 handing
// out credentials to anyone who asks.
//
// The account owner configuring a webhook is trusted to some degree — but
// "trusted to name a URL" and "trusted to make the hub POST signed traffic
// anywhere on the LAN" are different grants, and the second one should be
// deliberate. So private targets are refused unless the operator says
// allow_private, which is the legitimate case (their own Home Assistant) said
// out loud.
//
// This is validated at CONFIGURATION time and again at DELIVERY time. Once is
// not enough: a hostname that resolved to a public address when it was saved
// can resolve to 169.254.169.254 tomorrow, and DNS is controlled by whoever
// owns the name, not by us.

// validateWebhookURL checks a target at configuration time.
func validateWebhookURL(raw string, allowPrivate bool) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("webhook url: not a url")
	}
	switch u.Scheme {
	case "https":
	case "http":
		// Plaintext is permitted only alongside allow_private, because the
		// only defensible http:// target is one on a network the operator
		// controls. An http:// URL to the internet would put a signed record
		// of every gate opening on the wire in clear.
		if !allowPrivate {
			return nil, fmt.Errorf("webhook url: http:// requires allow_private (a plaintext target must be on your own network)")
		}
	default:
		return nil, fmt.Errorf("webhook url: scheme %q is not http or https", u.Scheme)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("webhook url: no host")
	}
	if u.User != nil {
		// Credentials in the URL would be logged by anything that logs a URL,
		// and the signature already authenticates the sender.
		return nil, fmt.Errorf("webhook url: must not contain credentials")
	}
	if !allowPrivate {
		if err := refusePrivateHost(u.Hostname()); err != nil {
			return nil, err
		}
	}
	return u, nil
}

// refusePrivateHost rejects a host that is, or resolves to, an address the hub
// should not be aimed at without an explicit opt-in.
//
// A hostname is resolved here rather than trusted: "metadata.example.com" is a
// public-looking name that can point anywhere. Every resolved address must be
// acceptable — one bad answer is enough to refuse, because we do not control
// which the dialler picks.
func refusePrivateHost(host string) error {
	if host == "" {
		return fmt.Errorf("webhook url: no host")
	}
	if ip := net.ParseIP(host); ip != nil {
		return refusePrivateIP(ip)
	}
	addrs, err := net.LookupIP(host)
	if err != nil {
		// Refuse rather than allow. A name that cannot be resolved now cannot
		// be shown to be safe now, and this runs at configuration time where a
		// clear refusal costs an operator nothing.
		return fmt.Errorf("webhook url: host %q does not resolve", host)
	}
	for _, ip := range addrs {
		if err := refusePrivateIP(ip); err != nil {
			return err
		}
	}
	return nil
}

func refusePrivateIP(ip net.IP) error {
	switch {
	case ip.IsLoopback():
		return fmt.Errorf("webhook url: loopback addresses need allow_private")
	case ip.IsLinkLocalUnicast(), ip.IsLinkLocalMulticast():
		// 169.254.0.0/16 covers cloud metadata services, which hand out
		// credentials to any local caller.
		return fmt.Errorf("webhook url: link-local addresses need allow_private")
	case ip.IsPrivate():
		return fmt.Errorf("webhook url: private addresses need allow_private")
	case ip.IsUnspecified():
		return fmt.Errorf("webhook url: unspecified address")
	case ip.IsMulticast():
		return fmt.Errorf("webhook url: multicast address")
	}
	// 100.64.0.0/10, carrier-grade NAT. Not covered by IsPrivate, and a hub on
	// a CGNAT'd link shares it with other subscribers.
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return fmt.Errorf("webhook url: carrier-grade NAT addresses need allow_private")
	}
	return nil
}
