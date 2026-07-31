package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
)

// The read path reaches EVERY rail, not the two it was built on.
//
// docs/CHAT-COMMANDS.md §4 is about what chat may disclose, not about WhatsApp.
// It landed on the free-text rails first because those were the ones where a
// question ACTUATED, which made them urgent — but the other three matched their
// command words exactly and so answered "when was the gate last opened?" with
// the welcome menu: an offer to open the gate the member had just asked about.
//
// Each rail is driven through its own real webhook, because "the shared helper
// is correct" and "this rail calls it" are different claims and only the second
// one is about the code a member actually reaches.

func TestEveryRailAnswersAQuestionAboutAGate(t *testing.T) {
	t.Run("telegram", func(t *testing.T) {
		e := setupChannels(t, permissiveRL())
		linkTelegram(t, e)
		tgPost(e.h, tgMessage(strangerTGID, strangerTGID, 41, "when was the gate last opened?"))
		assertAnswered(t, lastTG(t, e))
	})

	t.Run("slack", func(t *testing.T) {
		e := setupChannels(t, permissiveRL())
		if err := e.st.LinkChannelIdentity(context.Background(), channels.KindSlack, testSlackUID, e.ownID); err != nil {
			t.Fatal(err)
		}
		slackPost(e.h, "/webhooks/slack", slackEvent(testSlackUID, "when was the gate last opened?", "1700000000.0009"))
		sent := e.slack.all()
		if len(sent) == 0 {
			t.Fatal("slack sent nothing")
		}
		assertAnswered(t, sent[len(sent)-1].text)
	})

	t.Run("discord", func(t *testing.T) {
		e := setupDiscord(t)
		e.message(t, "q1", testDiscordUID, "when was the gate last opened?")
		assertAnswered(t, e.lastReply(t).text)
	})
}

// A question must not have become a command on any rail, and must not have
// silently become one on the rails that already matched words exactly.
func TestNoRailActuatesOnAQuestion(t *testing.T) {
	t.Run("telegram", func(t *testing.T) {
		e := setupChannels(t, permissiveRL())
		linkTelegram(t, e)
		tgPost(e.h, tgMessage(strangerTGID, strangerTGID, 42, "is the gate closed?"))
		if n := commandCount(t, e, channels.KindTelegram, "close"); n != 0 {
			t.Errorf("a question closed the gate on telegram: %d", n)
		}
	})

	t.Run("discord", func(t *testing.T) {
		e := setupDiscord(t)
		e.message(t, "q2", testDiscordUID, "is the gate closed?")
		if n := e.commands(t, channels.KindDiscord, "close"); n != 0 {
			t.Errorf("a question closed the gate on discord: %d", n)
		}
	})
}

// The control every rail needs: the command words still command. A question
// branch placed before them would swallow "open".
func TestEveryRailStillOpensOnTheCommandWord(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	linkTelegram(t, e)
	tgPost(e.h, tgMessage(strangerTGID, strangerTGID, 43, "open"))
	if n := commandCount(t, e, channels.KindTelegram, "open"); n != 1 {
		t.Errorf("telegram open: %d, want 1", n)
	}

	d := setupDiscord(t)
	d.message(t, "o1", testDiscordUID, "open")
	if n := d.commands(t, channels.KindDiscord, "open"); n != 1 {
		t.Errorf("discord open: %d, want 1", n)
	}
}

// linkTelegram binds the stranger's Telegram id to the account owner, which is
// what every rail's question branch needs before it will answer at all.
func linkTelegram(t *testing.T, e *chEnv) {
	t.Helper()
	if err := e.st.LinkChannelIdentity(context.Background(), channels.KindTelegram, strangerTG, e.ownID); err != nil {
		t.Fatal(err)
	}
}

func lastTG(t *testing.T, e *chEnv) string {
	t.Helper()
	all := e.tg.all()
	if len(all) == 0 {
		t.Fatal("telegram sent nothing")
	}
	return all[len(all)-1].text
}

// commandCount counts audited commands from one rail. chEnv has successOpens,
// which is open-only; a question that CLOSES a gate is the failure being
// checked here and would be invisible to it.
func commandCount(t *testing.T, e *chEnv, source, command string) int {
	t.Helper()
	logs, err := e.st.AccessLogsByAccount(context.Background(), e.acct, 100)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, l := range logs {
		if l.Success && l.Command == command && l.Source == source {
			n++
		}
	}
	return n
}

func assertAnswered(t *testing.T, reply string) {
	t.Helper()
	if reply == "" {
		t.Fatal("no reply")
	}
	if !strings.Contains(reply, "Main gate") {
		t.Errorf("question not answered from the record: %q", reply)
	}
	if !strings.Contains(reply, "not proof the gate moved") {
		t.Errorf("answer presents an ack as movement: %q", reply)
	}
	// The failure this replaces: a gate menu offering to open the gate the
	// member asked a question about.
	for _, menu := range []string{"Which gate", "Select a gate", "Tap a gate"} {
		if strings.Contains(reply, menu) {
			t.Errorf("question answered with a gate menu (%q): %q", menu, reply)
		}
	}
}
