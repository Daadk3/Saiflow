export default function TermsPage() {
  return (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="pt-16 pb-12 px-4 border-b border-white/10">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            Terms of Service
          </h1>
          <p className="text-gray-400">
            Last updated: December 2024
          </p>
        </div>
      </section>

      {/* Content */}
      <main className="py-12 px-4">
        <div className="max-w-4xl mx-auto prose prose-invert prose-lg">
          <div className="space-y-8 text-gray-300 leading-relaxed">
            
            {/* Acceptance of Terms */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">1. Acceptance of Terms</h2>
              <p>
                By accessing and using Saiflow (&quot;the Service&quot;), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.
              </p>
            </section>

            {/* Description of Service */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">2. Description of Service</h2>
              <p>
                Saiflow is a digital products marketplace that enables creators to sell digital products, courses, and memberships. We provide the platform and payment processing infrastructure, but we are not a party to transactions between buyers and sellers.
              </p>
            </section>

            {/* User Accounts */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">3. User Accounts</h2>
              <p>
                To use certain features of the Service, you must register for an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account.
              </p>
            </section>

            {/* Seller Responsibilities */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">4. Seller Responsibilities</h2>
              <p className="mb-3">
                As a seller on Saiflow, you agree to:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-3">
                <li>Provide accurate product descriptions and pricing</li>
                <li>Deliver digital products as described</li>
                <li>Comply with all applicable laws and regulations</li>
                <li>Not sell prohibited content (see Section 6)</li>
                <li>Pay all applicable fees (9% transaction fee)</li>
              </ul>
              <p>
                You retain ownership of your content and grant Saiflow a license to host, display, and distribute your products through the Service.
              </p>
            </section>

            {/* Buyer Rights */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">5. Buyer Rights</h2>
              <p className="mb-3">
                When you purchase a digital product on Saiflow:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-3">
                <li>You receive immediate access to download the purchased product</li>
                <li>You may download the product multiple times</li>
                <li>You receive lifetime access to the purchased file</li>
              </ul>
              <p className="font-semibold text-amber-400">
                <strong>No Refunds Policy:</strong> Due to the digital nature of products sold on Saiflow, all sales are final. We do not offer refunds for digital products once the download link has been provided, except as required by law.
              </p>
            </section>

            {/* Prohibited Content */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">6. Prohibited Content</h2>
              <p className="mb-3">
                You may not sell products that:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Violate any laws or regulations</li>
                <li>Infringe on intellectual property rights</li>
                <li>Contain malware, viruses, or harmful code</li>
                <li>Are fraudulent, misleading, or deceptive</li>
                <li>Promote illegal activities</li>
                <li>Contain hate speech or discriminatory content</li>
                <li>Violate privacy rights of others</li>
              </ul>
              <p className="mt-3">
                Saiflow reserves the right to remove any product that violates these terms without notice.
              </p>
            </section>

            {/* Payment Processing */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">7. Payment Processing</h2>
              <p>
                Payments are processed through third-party payment processors. Saiflow charges a 9% transaction fee on all sales. Sellers receive payments directly to their connected payment accounts. We are not responsible for payment processing errors or delays caused by third-party processors.
              </p>
            </section>

            {/* Intellectual Property */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">8. Intellectual Property</h2>
              <p>
                The Service, including its original content, features, and functionality, is owned by Saiflow and protected by international copyright, trademark, and other intellectual property laws. You may not reproduce, distribute, or create derivative works from the Service without our express written permission.
              </p>
            </section>

            {/* Limitation of Liability */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">9. Limitation of Liability</h2>
              <p>
                Saiflow shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the Service. Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim.
              </p>
            </section>

            {/* Termination */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">10. Termination</h2>
              <p>
                We may terminate or suspend your account and access to the Service immediately, without prior notice, for any reason, including breach of these Terms. Upon termination, your right to use the Service will cease immediately.
              </p>
            </section>

            {/* Changes to Terms */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">11. Changes to Terms</h2>
              <p>
                We reserve the right to modify these Terms at any time. We will notify users of any material changes by updating the &quot;Last updated&quot; date. Your continued use of the Service after changes become effective constitutes acceptance of the new Terms.
              </p>
            </section>

            {/* Contact Information */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">12. Contact Information</h2>
              <p>
                If you have any questions about these Terms of Service, please contact us at{" "}
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

