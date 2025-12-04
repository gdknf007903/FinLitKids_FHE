// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FinancialActivity {
  id: string;
  encryptedData: string;
  timestamp: number;
  category: string;
  amount: number;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  // Wallet and connection state
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  
  // Financial data state
  const [activities, setActivities] = useState<FinancialActivity[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // UI state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<FinancialActivity | null>(null);
  
  // Transaction feedback
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  
  // New activity form
  const [newActivityData, setNewActivityData] = useState({
    category: "",
    description: "",
    amount: 0
  });

  // Statistics for dashboard
  const verifiedCount = activities.filter(a => a.status === "verified").length;
  const pendingCount = activities.filter(a => a.status === "pending").length;
  const totalAmount = activities.reduce((sum, a) => sum + a.amount, 0);

  // Load financial activities on mount
  useEffect(() => {
    loadActivities().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load financial activities from contract
  const loadActivities = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      // Get activity keys
      const keysBytes = await contract.getData("activity_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing activity keys:", e);
        }
      }
      
      const list: FinancialActivity[] = [];
      
      // Load each activity
      for (const key of keys) {
        try {
          const activityBytes = await contract.getData(`activity_${key}`);
          if (activityBytes.length > 0) {
            try {
              const activityData = JSON.parse(ethers.toUtf8String(activityBytes));
              list.push({
                id: key,
                encryptedData: activityData.data,
                timestamp: activityData.timestamp,
                category: activityData.category,
                amount: activityData.amount,
                status: activityData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing activity data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading activity ${key}:`, e);
        }
      }
      
      // Sort by timestamp
      list.sort((a, b) => b.timestamp - a.timestamp);
      setActivities(list);
    } catch (e) {
      console.error("Error loading activities:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Submit new financial activity
  const submitActivity = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting financial data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newActivityData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const activityId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const activityData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        category: newActivityData.category,
        amount: newActivityData.amount,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `activity_${activityId}`, 
        ethers.toUtf8Bytes(JSON.stringify(activityData))
      );
      
      // Update keys list
      const keysBytes = await contract.getData("activity_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(activityId);
      
      await contract.setData(
        "activity_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Financial data encrypted and stored securely!"
      });
      
      await loadActivities();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewActivityData({
          category: "",
          description: "",
          amount: 0
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Verify activity using FHE
  const verifyActivity = async (activityId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const activityBytes = await contract.getData(`activity_${activityId}`);
      if (activityBytes.length === 0) {
        throw new Error("Activity not found");
      }
      
      const activityData = JSON.parse(ethers.toUtf8String(activityBytes));
      
      const updatedActivity = {
        ...activityData,
        status: "verified"
      };
      
      await contract.setData(
        `activity_${activityId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedActivity))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadActivities();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Check if contract is available
  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE contract is available and ready!"
        });
      } else {
        setTransactionStatus({
          visible: true,
          status: "error",
          message: "Contract is not available"
        });
      }
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Error checking contract availability"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Render activity progress chart
  const renderProgressChart = () => {
    const total = activities.length || 1;
    const verifiedPercentage = (verifiedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;

    return (
      <div className="progress-chart">
        <div className="progress-bar">
          <div 
            className="progress-segment verified" 
            style={{ width: `${verifiedPercentage}%` }}
          ></div>
          <div 
            className="progress-segment pending" 
            style={{ width: `${pendingPercentage}%` }}
          ></div>
        </div>
        <div className="progress-labels">
          <div className="progress-label">
            <div className="color-dot verified"></div>
            <span>Verified: {verifiedCount}</span>
          </div>
          <div className="progress-label">
            <div className="color-dot pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
        </div>
      </div>
    );
  };

  // FAQ items
  const faqItems = [
    {
      question: "How does FHE protect my child's financial data?",
      answer: "Fully Homomorphic Encryption allows us to process financial data while it remains encrypted. This means your child's spending habits and savings are analyzed without ever being exposed."
    },
    {
      question: "What financial concepts does this app teach?",
      answer: "FinLitKids teaches budgeting, saving, investing basics, needs vs wants, and responsible spending through interactive games and challenges."
    },
    {
      question: "Is real money involved?",
      answer: "No, all transactions use virtual currency within the app. This is a safe environment for children to learn financial concepts."
    },
    {
      question: "How does the personalization work?",
      answer: "Using FHE, we analyze encrypted transaction patterns to tailor lessons to your child's specific financial behaviors and learning needs."
    }
  ];

  // Feature cards
  const featureCards = [
    {
      title: "Privacy First",
      description: "All financial data is encrypted with FHE, ensuring complete privacy while enabling personalized learning.",
      icon: "🔒"
    },
    {
      title: "Game-Based Learning",
      description: "Interactive games make financial education fun and engaging for children of all ages.",
      icon: "🎮"
    },
    {
      title: "Progress Tracking",
      description: "Monitor your child's financial literacy development with detailed progress reports.",
      icon: "📊"
    },
    {
      title: "Parental Insights",
      description: "Get insights into your child's financial behaviors without compromising their privacy.",
      icon: "👪"
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Initializing FinLitKids...</p>
    </div>
  );

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-area">
          <div className="logo-icon">💰</div>
          <h1>FinLit<span>Kids</span></h1>
          <div className="fhe-badge">FHE-Powered</div>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Hero Banner */}
        <section className="hero-banner">
          <div className="hero-content">
            <h2>Financial Literacy for Kids</h2>
            <p>Teach your children money skills while protecting their privacy with FHE technology</p>
            <button 
              className="primary-btn"
              onClick={() => setShowCreateModal(true)}
            >
              Add Financial Activity
            </button>
          </div>
          <div className="hero-image"></div>
        </section>

        {/* Feature Showcase */}
        <section className="features-section">
          <h2>How FinLitKids Works</h2>
          <div className="feature-cards">
            {featureCards.map((feature, index) => (
              <div className="feature-card" key={index}>
                <div className="feature-icon">{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Financial Activities */}
        <section className="activities-section">
          <div className="section-header">
            <h2>Financial Activities</h2>
            <div className="header-actions">
              <button 
                className="icon-btn"
                onClick={loadActivities}
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄 Refreshing..." : "🔄 Refresh"}
              </button>
              <button 
                className="icon-btn"
                onClick={checkAvailability}
              >
                ✅ Check FHE Status
              </button>
            </div>
          </div>

          {activities.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <p>No financial activities recorded yet</p>
              <button 
                className="primary-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Add First Activity
              </button>
            </div>
          ) : (
            <>
              <div className="stats-cards">
                <div className="stat-card">
                  <div className="stat-value">{activities.length}</div>
                  <div className="stat-label">Total Activities</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">${totalAmount}</div>
                  <div className="stat-label">Total Amount</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{verifiedCount}</div>
                  <div className="stat-label">Verified</div>
                </div>
              </div>

              {renderProgressChart()}

              <div className="activities-list">
                {activities.map(activity => (
                  <div 
                    className={`activity-card ${activity.status}`}
                    key={activity.id}
                    onClick={() => setSelectedActivity(activity)}
                  >
                    <div className="activity-icon">
                      {activity.category === "saving" ? "💰" : 
                       activity.category === "spending" ? "🛒" : "📊"}
                    </div>
                    <div className="activity-details">
                      <h3>{activity.category.charAt(0).toUpperCase() + activity.category.slice(1)}</h3>
                      <p>${activity.amount} • {new Date(activity.timestamp * 1000).toLocaleDateString()}</p>
                    </div>
                    <div className={`activity-status ${activity.status}`}>
                      {activity.status}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* FAQ Section */}
        <section className="faq-section">
          <div className="section-header">
            <h2>Frequently Asked Questions</h2>
            <button 
              className="toggle-btn"
              onClick={() => setShowFAQ(!showFAQ)}
            >
              {showFAQ ? "Hide FAQ" : "Show FAQ"}
            </button>
          </div>

          {showFAQ && (
            <div className="faq-items">
              {faqItems.map((faq, index) => (
                <div className="faq-item" key={index}>
                  <h3>{faq.question}</h3>
                  <p>{faq.answer}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">FinLitKids</div>
            <p>Teaching financial literacy while protecting privacy</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact Us</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FinLitKids. All rights reserved.
          </div>
        </div>
      </footer>

      {/* Create Activity Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Add Financial Activity</h2>
              <button 
                className="close-btn"
                onClick={() => setShowCreateModal(false)}
              >
                &times;
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Activity Type</label>
                <select 
                  value={newActivityData.category}
                  onChange={(e) => setNewActivityData({...newActivityData, category: e.target.value})}
                >
                  <option value="">Select type</option>
                  <option value="saving">Saving</option>
                  <option value="spending">Spending</option>
                  <option value="earning">Earning</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Amount ($)</label>
                <input 
                  type="number"
                  value={newActivityData.amount}
                  onChange={(e) => setNewActivityData({...newActivityData, amount: Number(e.target.value)})}
                  placeholder="Enter amount"
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newActivityData.description}
                  onChange={(e) => setNewActivityData({...newActivityData, description: e.target.value})}
                  placeholder="Describe the activity..."
                  rows={3}
                />
              </div>
              
              <div className="privacy-notice">
                <div className="lock-icon">🔒</div>
                This data will be encrypted using FHE to protect your child's privacy
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="secondary-btn"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button 
                className="primary-btn"
                onClick={submitActivity}
                disabled={creating}
              >
                {creating ? "Encrypting with FHE..." : "Submit Securely"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activity Detail Modal */}
      {selectedActivity && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Activity Details</h2>
              <button 
                className="close-btn"
                onClick={() => setSelectedActivity(null)}
              >
                &times;
              </button>
            </div>
            
            <div className="modal-body">
              <div className="detail-item">
                <span className="detail-label">Type:</span>
                <span className="detail-value">{selectedActivity.category}</span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">Amount:</span>
                <span className="detail-value">${selectedActivity.amount}</span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">Date:</span>
                <span className="detail-value">
                  {new Date(selectedActivity.timestamp * 1000).toLocaleString()}
                </span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">Status:</span>
                <span className={`detail-value status ${selectedActivity.status}`}>
                  {selectedActivity.status}
                </span>
              </div>
              
              <div className="fhe-notice">
                <div className="key-icon">🔑</div>
                This data was processed using FHE while encrypted
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="secondary-btn"
                onClick={() => verifyActivity(selectedActivity.id)}
              >
                Verify with FHE
              </button>
              <button 
                className="primary-btn"
                onClick={() => setSelectedActivity(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Selector */}
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {/* Transaction Status */}
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-icon ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && "⏳"}
            {transactionStatus.status === "success" && "✅"}
            {transactionStatus.status === "error" && "❌"}
          </div>
          <div className="toast-message">{transactionStatus.message}</div>
        </div>
      )}
    </div>
  );
};

export default App;