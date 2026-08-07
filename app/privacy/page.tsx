export default function PrivacyPage() {
  return (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="pt-16 pb-12 px-4 border-b border-white/10">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            Privacy Policy
          </h1>
          <p className="text-gray-400">
            Last updated: July 2026
          </p>
        </div>
      </section>

      {/* Content */}
      <main className="py-12 px-4">
        <div className="max-w-4xl mx-auto prose prose-invert prose-lg">
          <div className="space-y-8 text-gray-300 leading-relaxed">
            
            {/* Introduction */}
            <section>
              <p>
                At Saiflow, we take your privacy seriously. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our digital products marketplace. Saiflow is operated from the Kingdom of Saudi Arabia and processes personal data in accordance with the Saudi Personal Data Protection Law (PDPL).
              </p>
            </section>

            {/* Information We Collect */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">1. Information We Collect</h2>
              <p className="mb-3">
                We collect information that you provide directly to us:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-3">
                <li><strong>Account Information:</strong> Name, email address, and password when you create an account</li>
                <li><strong>Profile Information:</strong> Optional profile details, shop information, and product listings</li>
                <li><strong>Payment Information:</strong> Payment details are processed by licensed third-party payment service providers. We never receive or store your full card details.</li>
                <li><strong>Transaction Information:</strong> Purchase history, product downloads, and sales data</li>
                <li><strong>Communication Data:</strong> Messages you send to our support team</li>
              </ul>
              <p className="mb-3">
                We also automatically collect certain information:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Device information (IP address, browser type, operating system)</li>
                <li>Usage data (pages visited, time spent, features used)</li>
                <li>Cookies and similar tracking technologies</li>
              </ul>
            </section>

            {/* How We Use Your Information */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">2. How We Use Your Information</h2>
              <p className="mb-3">
                We use the information we collect to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide, maintain, and improve our Service</li>
                <li>Process transactions and send related information</li>
                <li>Send you technical notices, updates, and support messages</li>
                <li>Respond to your comments, questions, and requests</li>
                <li>Monitor and analyze usage patterns and trends</li>
                <li>Detect, prevent, and address technical issues and fraud</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            {/* Data Storage and Security */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">3. Data Storage and Security</h2>
              <p>
                We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your information, we cannot guarantee absolute security.
              </p>
            </section>

            {/* Third-Party Services */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">4. Third-Party Services</h2>
              <p className="mb-3">
                We use third-party services that may collect information about you:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-3">
                <li><strong>Payment Processing:</strong> Payments are handled by licensed payment service providers. Their use of your personal information is governed by their own privacy policies. We never store your full card details.</li>
                <li><strong>Hosting &amp; Database (Vercel, Neon):</strong> Our application and database are hosted on infrastructure located in the United States.</li>
                <li><strong>File Hosting (UploadThing):</strong> Digital product files and images are hosted and delivered by UploadThing (United States).</li>
                <li><strong>Transactional Email (Resend):</strong> Purchase receipts and account emails are sent via Resend (United States).</li>
              </ul>
              <p className="mb-3">
                <strong className="text-white">Cross-border transfers:</strong> Because these providers operate outside the Kingdom of Saudi Arabia, some personal data (such as your email address and order details) is transferred to and stored in the United States. We limit such transfers to the minimum data necessary to deliver the Service, and we apply appropriate technical safeguards in line with the PDPL&apos;s data transfer provisions.
              </p>
              <p>
                These third parties have their own privacy policies. We encourage you to review them.
              </p>
            </section>

            {/* AI-assisted listing */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">5. AI-Assisted Listing Content</h2>
              <p className="mb-3">
                Sellers may optionally use our AI listing assistant when creating a product. It is entirely optional, and products can be created without it.
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-3">
                <li><strong>What is sent:</strong> only the listing text the seller types or pastes into the assistant — the product title, short description, intended audience and any details they choose to paste, together with the selected category and language.</li>
                <li><strong>What is never sent:</strong> uploaded product files, customer data, order information, and any other account data. The assistant does not read files.</li>
                <li><strong>Purpose:</strong> to generate draft listing text that the seller reviews, edits and applies manually. Nothing generated is saved or published automatically.</li>
                <li><strong>External processing:</strong> this text is processed by a third-party AI provider acting as a processor on our behalf. Sellers are asked not to paste personal or confidential information.</li>
                <li><strong>Retention:</strong> we store a cryptographic hash of the input rather than the input itself, along with the generated suggestions, the model name and basic timing, so we can enforce usage limits and audit the feature. We do not retain the raw text the seller submitted.</li>
              </ul>
              <p>
                We do not make any claim about whether a provider uses submitted text for model training; sellers should not submit confidential material to the assistant.
              </p>
            </section>

            {/* Cookies */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">6. Cookies</h2>
              <p>
                We use cookies and similar tracking technologies to track activity on our Service and hold certain information. Cookies are files with a small amount of data that may include an anonymous unique identifier. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent. However, if you do not accept cookies, you may not be able to use some portions of our Service.
              </p>
            </section>

            {/* Your Rights */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">7. Your Rights</h2>
              <p className="mb-3">
                Under the Saudi Personal Data Protection Law (PDPL), and other laws that may apply to you, you have rights regarding your personal information, including:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Access:</strong> Request access to your personal information</li>
                <li><strong>Correction:</strong> Request correction of inaccurate information</li>
                <li><strong>Deletion:</strong> Request deletion of your personal information</li>
                <li><strong>Portability:</strong> Request transfer of your data to another service</li>
                <li><strong>Objection:</strong> Object to processing of your personal information</li>
              </ul>
              <p className="mt-3">
                To exercise these rights, please contact us at{" "}
                <a href="mailto:support@saiflow.io" className="text-teal-400 hover:text-teal-300 underline">
                  support@saiflow.io
                </a>
              </p>
            </section>

            {/* Data Retention */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">8. Data Retention</h2>
              <p>
                We retain your personal information for as long as necessary to provide the Service and fulfill the purposes outlined in this Privacy Policy, unless a longer retention period is required or permitted by law. When you delete your account, we will delete or anonymize your personal information, except where we are required to retain it for legal or business purposes.
              </p>
            </section>

            {/* Children's Privacy */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">9. Children&apos;s Privacy</h2>
              <p>
                Our Service is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13. If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately.
              </p>
            </section>

            {/* Changes to Privacy Policy */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">10. Changes to Privacy Policy</h2>
              <p>
                We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the &quot;Last updated&quot; date. You are advised to review this Privacy Policy periodically for any changes.
              </p>
            </section>

            {/* Contact Us */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">11. Contact Us</h2>
              <p>
                If you have any questions about this Privacy Policy, please contact us at{" "}
                <a href="mailto:support@saiflow.io" className="text-teal-400 hover:text-teal-300 underline">
                  support@saiflow.io
                </a>
              </p>
            </section>

          </div>
        </div>
      </main>
    </div>
  );
}

