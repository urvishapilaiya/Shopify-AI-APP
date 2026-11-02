
(function () {
  if (document.getElementById("ai-chatbot-widget")) return;

  const root = document.getElementById("ai-chatbot-root");
  const shopDomain = root?.dataset.shopDomain;

  if (!shopDomain) {
    console.error("Shopify store domain not found.");
    return;
  }

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
          <small>Ask about our products</small>
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

  async function answerQuestion(question) {
    const normalized = question.toLowerCase();

    try {
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
        "I can currently answer questions about product counts and show products. Try asking: How many products do you have?",
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
