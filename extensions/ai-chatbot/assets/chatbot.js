
(function () {
  if (document.getElementById("ai-chatbot-widget")) return;

  const root = document.getElementById("ai-chatbot-root");
  const shopDomain = root?.dataset.shopDomain;

  if (!shopDomain) {
    console.error("Shopify store domain not found.");
    return;
  }

  const orderApi = (root.dataset.orderApi || "").replace(/\/$/, "");
  const orderState = { step: null, order: null };

  const endpoint =
    `https://${shopDomain}/api/2026-10/graphql.json`;

  const widget = document.createElement("div");
  widget.id = "ai-chatbot-widget";

  widget.innerHTML = `
    <button id="ai-chat-toggle" aria-label="Open AI chat">
      💬
    </button>

    <section id="ai-chat-window" hidden>
      <header class="ai-chat-header">
        <div>
          <strong>AI Shopping Assistant</strong>
          <small>Ask about products or track an order</small>
        </div>
        <button id="ai-chat-close">×</button>
      </header>

      <div id="ai-chat-messages" aria-live="polite">
        <div class="ai-message bot">
          Hi! 👋 Welcome to our store.
          How can I help you today?
        </div>
      </div>

      <form id="ai-chat-form">
        <input
          id="ai-chat-input"
          placeholder="Ask about our products..."
          autocomplete="off"
          required
        />
        <button type="submit">Send</button>
      </form>
    </section>
  `;

  document.body.appendChild(widget);

  const panel = document.getElementById("ai-chat-window");
  const messages = document.getElementById("ai-chat-messages");
  const input = document.getElementById("ai-chat-input");

  document.getElementById("ai-chat-toggle").onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) input.focus();
  };

  document.getElementById("ai-chat-close").onclick = () => {
    panel.hidden = true;
  };

  async function shopifyQuery(query, variables = {}) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    return result.data;
  }

  // Retrieve a page of published products.
  async function getProducts() {
    const query = `
      query GetProducts {
        products(first: 20) {
          nodes {
            id
            title
            handle
            description
            featuredImage {
              url
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    `;

    const data = await shopifyQuery(query);
    return data.products.nodes;
  }

  // Count all published products using pagination.
  async function getProductCount() {
    let count = 0;
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const query = `
        query CountProducts($cursor: String) {
          products(first: 250, after: $cursor) {
            nodes {
              id
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const data = await shopifyQuery(query, {
        cursor
      });

      const connection = data.products;

      count += connection.nodes.length;
      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor;
    }

    return count;
  }

  function addMessage(text, type) {
    const message = document.createElement("div");
    message.className = `ai-message ${type}`;
    message.textContent = text;

    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  }


  // ---------- order tracking ----------
  const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  const TRACK_RE = /\b(track|tracking|order status|where('| i)?s my (order|package|parcel)|my order|status of (my )?order|delivery status)\b/i;

  function findOrderNumber(text) {
    const m = text.replace(EMAIL_RE, "").match(/#?\b(\d{3,10})\b/);
    return m ? m[1] : null;
  }

  async function lookupOrder(order, email) {
    orderState.step = null;
    orderState.order = null;

    if (!orderApi) {
      addMessage("Order tracking isn't set up yet. Please contact us for help.", "bot");
      return;
    }

    addMessage("Checking your order...", "bot");

    let res, data;
    try {
      res = await fetch(orderApi + "/api/track-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order, email })
      });
      data = await res.json();
    } catch (e) {
      addMessage("Sorry, I couldn't reach the order system. Please try again.", "bot");
      return;
    }

    if (!res.ok) {
      addMessage((data && data.error) || "Sorry, I couldn't find that order.", "bot");
      return;
    }

    const status = data.cancelled ? "Cancelled" : data.statusLabel;
    addMessage(`Order ${data.name}: ${status}.`, "bot");

    data.shipments.forEach(s => {
      if (!s.number && !s.url) return;
      const item = document.createElement("div");
      item.className = "ai-message bot";
      item.appendChild(document.createTextNode(`${s.company || "Carrier"}: `));
      if (/^https?:\/\//i.test(s.url || "")) {
        const a = document.createElement("a");
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = s.number || "Track package";
        item.appendChild(a);
      } else {
        item.appendChild(document.createTextNode(s.number || ""));
      }
      messages.appendChild(item);
    });
    messages.scrollTop = messages.scrollHeight;
  }

  // Returns true if the message was handled by the order flow.
  async function handleOrderFlow(question) {
    const email = (question.match(EMAIL_RE) || [])[0];
    const number = findOrderNumber(question);

    if (/\b(cancel|stop|never ?mind|forget it)\b/i.test(question) && orderState.step) {
      orderState.step = null;
      orderState.order = null;
      addMessage("Okay, no problem. Anything else I can help with?", "bot");
      return true;
    }

    if (!orderState.step && !TRACK_RE.test(question)) return false;

    if (number) orderState.order = number;

    if (!orderState.order) {
      orderState.step = "order";
      addMessage("Sure! What's your order number? (e.g. 1001)", "bot");
      return true;
    }
    if (!email) {
      orderState.step = "email";
      addMessage("Thanks. What email address did you use at checkout?", "bot");
      return true;
    }
    await lookupOrder(orderState.order, email);
    return true;
  }

  async function answerQuestion(question) {
    const normalized = question.toLowerCase();

    try {
      if (await handleOrderFlow(question)) return;

      if (
        normalized.includes("how many") &&
        normalized.includes("product")
      ) {
        addMessage("Checking our product catalogue...", "bot");

        const count = await getProductCount();

        addMessage(
          `Our store currently has ${count} published products.`,
          "bot"
        );

        return;
      }

      if (
        normalized.includes("show") ||
        normalized.includes("list") ||
        normalized.includes("product")
      ) {
        addMessage("Looking up our products...", "bot");

        const products = await getProducts();

        if (!products.length) {
          addMessage("No published products were found.", "bot");
          return;
        }

        products.forEach(product => {
          const price = product.priceRange.minVariantPrice;

          const item = document.createElement("div");
          item.className = "ai-message bot";

          const link = document.createElement("a");
          link.href = `/products/${encodeURIComponent(product.handle)}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = product.title;

          const priceText = document.createElement("p");
          priceText.textContent =
            `${price.amount} ${price.currencyCode}`;

          item.appendChild(link);
          item.appendChild(priceText);
          messages.appendChild(item);
        });

        messages.scrollTop = messages.scrollHeight;
        return;
      }

      addMessage(
        "I can show products, count products, and track your order. Try: How many products do you have? or Track my order",
        "bot"
      );

    } catch (error) {
      console.error("Chatbot error:", error);

      addMessage(
        "Sorry, I couldn't retrieve product information. Please try again.",
        "bot"
      );
    }
  }

  document.getElementById("ai-chat-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const question = input.value.trim();
      if (!question) return;

      addMessage(question, "user");
      input.value = "";

      await answerQuestion(question);
    }
  );
})();
