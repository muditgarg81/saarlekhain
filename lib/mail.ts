import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpFrom = process.env.SMTP_FROM || '"Saarlekha Portal" <noreply@saarlekhain.com>';

export async function sendInvitationEmail(data: {
  email: string;
  companyName: string;
  role: string;
  appUrl: string;
}) {
  const { email, companyName, role, appUrl } = data;
  const invitationLink = `${appUrl}/auth/forgot-password?email=${encodeURIComponent(email)}`;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #FAF6F0; padding: 40px 20px; text-align: center;">
      <div style="max-width: 500px; margin: 0 auto; background: #FFFFFF; border: 1px solid #13131310; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(19, 19, 19, 0.05); text-align: left;">
        <h2 style="font-family: Georgia, serif; font-size: 24px; font-weight: bold; color: #131313; margin-top: 0;">Saarlekha</h2>
        <p style="font-size: 14px; color: #13131380; font-family: monospace; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 24px;">Company Invitation</p>
        
        <p style="font-size: 15px; color: #131313; line-height: 1.6; margin-bottom: 20px;">
          You have been invited to join the company <strong>${companyName}</strong> on the Saarlekha Stores & Purchase portal as a <strong>${role.replace("_", " ")}</strong>.
        </p>
        
        <p style="font-size: 14px; color: #13131380; line-height: 1.6; margin-bottom: 30px;">
          Please click the button below to set up your account password and activate your login:
        </p>
        
        <div style="text-align: center; margin-bottom: 30px;">
          <a href="${invitationLink}" style="display: inline-block; background-color: #DDA15E; color: #131313; font-weight: bold; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-size: 14px; box-shadow: 0 4px 10px rgba(221, 161, 94, 0.3); transition: all 0.2s;">
            Set Password & Activate
          </a>
        </div>
        
        <p style="font-size: 11px; color: #13131350; line-height: 1.6; margin-bottom: 0; word-break: break-all;">
          If the button doesn't work, copy and paste this URL into your browser:<br />
          <a href="${invitationLink}" style="color: #DDA15E; text-decoration: underline;">${invitationLink}</a>
        </p>
      </div>
      <p style="font-size: 11px; color: #13131340; margin-top: 20px; text-align: center;">
        Saarlekha Stores & Purchase Portal. Secure Isolated Workspace.
      </p>
    </div>
  `;

  const textContent = `
    Welcome to Saarlekha!
    
    You have been invited to join the company "${companyName}" on the Saarlekha Stores & Purchase portal as a ${role.replace("_", " ")}.
    
    Please use the following link to set up your account password and activate your login:
    ${invitationLink}
    
    Saarlekha Stores & Purchase Portal.
  `;

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.log("----------------------------------------");
    console.log(`[MOCK EMAIL DISPATCH] To: ${email}`);
    console.log(`Subject: Invitation to join ${companyName} on Saarlekha`);
    console.log(`Link: ${invitationLink}`);
    console.log("----------------------------------------");
    return { success: true, mock: true, link: invitationLink };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: `Invitation to join ${companyName} on Saarlekha`,
      text: textContent,
      html: htmlContent,
    });

    console.log(`[EMAIL DISPATCH] Invitation email successfully sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to send invitation email via SMTP:", error);
    return { success: false, error, link: invitationLink };
  }
}
