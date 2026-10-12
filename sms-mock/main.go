package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed index.html
var indexHTML []byte

type Message struct {
	ID        string    `json:"id"`
	To        string    `json:"to"`
	From      string    `json:"from"`
	Text      string    `json:"text"`
	OTP       string    `json:"otp"`
	CreatedAt time.Time `json:"createdAt"`
	Channel   string    `json:"channel"`
}

type MessageStore struct {
	sync.RWMutex
	messages []Message
	maxLimit int
	clients  map[chan Message]bool
}

var (
	store = &MessageStore{
		messages: make([]Message, 0),
		maxLimit: 500,
		clients:  make(map[chan Message]bool),
	}

	reOTPKey    = regexp.MustCompile(`(?i)(?:otp|code|mã(?:\s*xác\s*thực)?|passcode|pin|verification)\s*(?:is|là|:|\s)\s*([0-9]{4,8})`)
	reStandalone = regexp.MustCompile(`\b([0-9]{4,8})\b`)
)

func extractOTP(text string) string {
	matches := reOTPKey.FindStringSubmatch(text)
	if len(matches) > 1 {
		return matches[1]
	}
	matches = reStandalone.FindStringSubmatch(text)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

func (s *MessageStore) Add(to, from, text, channel string) Message {
	s.Lock()
	defer s.Unlock()

	msg := Message{
		ID:        fmt.Sprintf("msg_%d_%04d", time.Now().UnixNano(), len(s.messages)%1000),
		To:        strings.TrimSpace(to),
		From:      strings.TrimSpace(from),
		Text:      strings.TrimSpace(text),
		OTP:       extractOTP(text),
		CreatedAt: time.Now(),
		Channel:   channel,
	}

	if msg.From == "" {
		msg.From = "MOCK-SMS"
	}

	s.messages = append([]Message{msg}, s.messages...)
	if len(s.messages) > s.maxLimit {
		s.messages = s.messages[:s.maxLimit]
	}

	for ch := range s.clients {
		select {
		case ch <- msg:
		default:
		}
	}

	return msg
}

func (s *MessageStore) GetAll(phone, search string, limit int) []Message {
	s.RLock()
	defer s.RUnlock()

	var result []Message
	phone = strings.TrimSpace(phone)
	search = strings.ToLower(strings.TrimSpace(search))

	for _, m := range s.messages {
		if phone != "" && !strings.Contains(m.To, phone) {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(m.Text), search) && !strings.Contains(strings.ToLower(m.From), search) {
			continue
		}
		result = append(result, m)
		if limit > 0 && len(result) >= limit {
			break
		}
	}
	return result
}

func (s *MessageStore) GetLatest(phone string) *Message {
	s.RLock()
	defer s.RUnlock()

	phone = strings.TrimSpace(phone)
	for _, m := range s.messages {
		if phone == "" || strings.Contains(m.To, phone) {
			copyMsg := m
			return &copyMsg
		}
	}
	return nil
}

func (s *MessageStore) Clear() {
	s.Lock()
	defer s.Unlock()
	s.messages = make([]Message, 0)
}

func (s *MessageStore) Subscribe() chan Message {
	s.Lock()
	defer s.Unlock()
	ch := make(chan Message, 10)
	s.clients[ch] = true
	return ch
}

func (s *MessageStore) Unsubscribe(ch chan Message) {
	s.Lock()
	defer s.Unlock()
	delete(s.clients, ch)
	close(ch)
}

func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(indexHTML)
}

func handleSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var to, from, text string

	if strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		var req struct {
			To      string `json:"to"`
			Phone   string `json:"phone"`
			From    string `json:"from"`
			Sender  string `json:"sender"`
			Text    string `json:"text"`
			Message string `json:"message"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		to = req.To
		if to == "" {
			to = req.Phone
		}
		from = req.From
		if from == "" {
			from = req.Sender
		}
		text = req.Text
		if text == "" {
			text = req.Message
		}
		if text == "" {
			text = req.Content
		}
	} else {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Invalid form data", http.StatusBadRequest)
			return
		}
		to = r.FormValue("to")
		if to == "" {
			to = r.FormValue("phone")
		}
		from = r.FormValue("from")
		if from == "" {
			from = r.FormValue("sender")
		}
		text = r.FormValue("text")
		if text == "" {
			text = r.FormValue("message")
		}
		if text == "" {
			text = r.FormValue("content")
		}
	}

	if to == "" || text == "" {
		http.Error(w, "Fields 'to' and 'text'/'message' are required", http.StatusBadRequest)
		return
	}

	msg := store.Add(to, from, text, "generic")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": msg,
	})
}

func handleTwilio(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	_ = r.ParseForm()
	to := r.FormValue("To")
	from := r.FormValue("From")
	body := r.FormValue("Body")

	if to == "" || body == "" {
		var req struct {
			To   string `json:"To"`
			From string `json:"From"`
			Body string `json:"Body"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.To != "" {
			to = req.To
		}
		if req.From != "" {
			from = req.From
		}
		if req.Body != "" {
			body = req.Body
		}
	}

	if to == "" || body == "" {
		http.Error(w, `{"code": 21604, "message": "A 'To' and 'Body' phone number is required."}`, http.StatusBadRequest)
		return
	}

	msg := store.Add(to, from, body, "twilio")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sid":          msg.ID,
		"status":       "delivered",
		"to":           msg.To,
		"from":         msg.From,
		"body":         msg.Text,
		"date_created": msg.CreatedAt.Format(time.RFC1123Z),
		"direction":    "outbound-api",
		"price":        "0.00",
		"price_unit":   "USD",
	})
}

func handleList(w http.ResponseWriter, r *http.Request) {
	phone := r.URL.Query().Get("phone")
	search := r.URL.Query().Get("search")
	limitStr := r.URL.Query().Get("limit")

	limit := 100
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	messages := store.GetAll(phone, search, limit)
	if messages == nil {
		messages = []Message{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total":    len(messages),
		"messages": messages,
	})
}

func handleOTP(w http.ResponseWriter, r *http.Request) {
	phone := r.URL.Query().Get("phone")
	msg := store.GetLatest(phone)

	w.Header().Set("Content-Type", "application/json")
	if msg == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"found":   false,
			"message": "No messages found for this phone",
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"found":     true,
		"otp":       msg.OTP,
		"phone":     msg.To,
		"from":      msg.From,
		"text":      msg.Text,
		"timestamp": msg.CreatedAt,
	})
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	store.Clear()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "All messages cleared",
	})
}

func handleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := store.Subscribe()
	defer store.Unsubscribe(ch)

	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case msg := <-ch:
			data, err := json.Marshal(msg)
			if err == nil {
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"healthy","uptime":"ok"}`))
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Seed with an example message for instant demo
	store.Add("+84399424608", "TECH-OTP", "Ma xac thuc OTP cua ban la 592810. Co hieu luc trong 5 phut.", "system")

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/sms/send", withCORS(handleSend))
	http.HandleFunc("/api/messages", withCORS(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleList(w, r)
		case http.MethodPost:
			handleSend(w, r)
		case http.MethodDelete:
			handleDelete(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	http.HandleFunc("/api/otp", withCORS(handleOTP))
	http.HandleFunc("/api/stream", withCORS(handleStream))
	http.HandleFunc("/healthz", handleHealth)

	// Twilio compatible route
	http.HandleFunc("/2010-04-01/Accounts/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "Messages.json") {
			handleTwilio(w, r)
			return
		}
		http.NotFound(w, r)
	}))

	log.Printf("SMS Mock Server starting on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
