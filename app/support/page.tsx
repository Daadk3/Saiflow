"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

const faqs = [
  {
    question: "How do I create a product?",
    answer: "To create a product, first create a shop from your dashboard. Then, click &apos;Add Product&apos; in your shop. Fill in the product details (name, description, price), upload your digital file, and click &apos;Create Product&apos;. Your product will be live immediately with a unique link you can share.",
  },
  {
    question: "How do I upload files?",
    answer: "When creating or editing a product, you&apos;ll see an &apos;Upload File&apos; button. Click it to select your file from your computer. Supported formats include PDFs, videos, audio files, ZIP archives, images, and more. Files are securely hosted and delivered to customers after purchase.",
  },
  {
    question: "When do I get paid?",
    answer: "You get paid instantly! As soon as a customer completes a purchase, the money is transferred to your connected payment account. There&apos;s no waiting period or monthly payout schedule.",
  },
  {
    question: "How do customers receive their files?",
    answer: "After a successful purchase, customers receive an email with a secure download link. They can download the file immediately and have lifetime access to re-download it. The link is unique to their purchase and cannot be shared.",
  },
  {
    question: "Can I edit my product after publishing?",
    answer: "Yes! You can edit your product at any time from your dashboard. Go to your shop, find the product, and click &apos;Edit&apos;. You can update the name, description, price, and even replace the file. Changes take effect immediately.",
  },
  {
    question: "How do I delete my account?",
    answer: "To delete your account, please contact us at support@saiflow.io with your account email. We&apos;ll process your request and permanently delete your account and all associated data within 30 days, in accordance with our Privacy Policy.",
  },
];

export default function SupportPage() {
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "General",
    message: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { name, email, subject, message } = formData;
    const mailtoLink = `mailto:support@saiflow.io?subject=${encodeURIComponent(subject)} - ${encodeURIComponent(name)}&body=${encodeURIComponent(`From: ${name} (${email})\n\n${message}`)}`;
    
    // Try to open mailto link (may be blocked by browser)
    try {
      window.location.href = mailtoLink;
    } catch (err) {
      // If mailto fails, continue with redirect
    }
    
    // Redirect to success page after a brief delay
    setTimeout(() => {
      router.push("/support/success");
    }, 300);
  };

  const scrollToFaqs = () => {
    const faqSection = document.getElementById("faqs");
    if (faqSection) {
      faqSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="pt-16 pb-12 px-4 border-b border-white/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            How can we help?
          </h1>
          <p className="text-xl text-gray-400">
            We&apos;re here to help you succeed
          </p>
        </div>
      </section>

      {/* Contact Options Grid */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            {/* Email Support */}
            <div className="bg-[#1A1A1A] rounded-2xl border border-white/10 p-8 hover:border-teal-500/50 transition-all duration-200">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Email Us</h3>
              <p className="text-gray-400 mb-6">
                Get a response within 24 hours
              </p>
              <a
                href="mailto:support@saiflow.io"
                className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black font-semibold px-6 py-3 rounded-xl transition-colors"
              >
                Send Email
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </a>
            </div>

            {/* FAQs */}
            <div className="bg-[#1A1A1A] rounded-2xl border border-white/10 p-8 hover:border-teal-500/50 transition-all duration-200">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">FAQs</h3>
              <p className="text-gray-400 mb-6">
                Find quick answers to common questions
              </p>
              <button
                onClick={scrollToFaqs}
                className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black font-semibold px-6 py-3 rounded-xl transition-colors"
              >
                View FAQs
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>

            {/* Twitter/X */}
            <div className="bg-[#1A1A1A] rounded-2xl border border-white/10 p-8 hover:border-teal-500/50 transition-all duration-200">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-teal-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Twitter/X</h3>
              <p className="text-gray-400 mb-6">
                Follow us for updates
              </p>
              <a
                href="https://twitter.com/saiflow"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black font-semibold px-6 py-3 rounded-xl transition-colors"
              >
                Follow Us
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faqs" className="py-16 px-4 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Frequently asked questions
            </h2>
            <p className="text-gray-400">
              Quick answers to common questions
            </p>
          </div>

          {/* FAQ Accordion */}
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="bg-[#1A1A1A] rounded-2xl border border-white/10 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full flex items-center justify-between p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <span className="text-white font-medium pr-4">{faq.question}</span>
                  <svg
                    className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
                      openFaq === index ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === index && (
                  <div className="px-6 pb-6">
                    <p className="text-gray-400 leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Send us a message
            </h2>
            <p className="text-gray-400">
              Can&apos;t find what you&apos;re looking for? We&apos;re here to help.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="bg-[#1A1A1A] rounded-2xl border border-white/10 p-8 space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
                Name
              </label>
              <input
                type="text"
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 bg-[#0A0A0A] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-teal-500 transition-colors"
                placeholder="Your name"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                type="email"
                id="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-3 bg-[#0A0A0A] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-teal-500 transition-colors"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-gray-300 mb-2">
                Subject
              </label>
              <select
                id="subject"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="w-full px-4 py-3 bg-[#0A0A0A] border border-white/10 rounded-xl text-white focus:outline-none focus:border-teal-500 transition-colors"
              >
                <option value="General">General</option>
                <option value="Technical">Technical</option>
                <option value="Billing">Billing</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-medium text-gray-300 mb-2">
                Message
              </label>
              <textarea
                id="message"
                required
                rows={6}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="w-full px-4 py-3 bg-[#0A0A0A] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-teal-500 transition-colors resize-none"
                placeholder="Tell us how we can help..."
              />
            </div>

            <button
              type="submit"
              className="w-full bg-teal-500 hover:bg-teal-400 text-black font-semibold px-6 py-4 rounded-xl transition-colors shadow-lg shadow-teal-500/25"
            >
              Send Message
            </button>

            <p className="text-sm text-gray-500 text-center">
              This form will open your email client to send a message to support@saiflow.io
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}

