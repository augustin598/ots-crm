import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { db } from './db';
import * as table from './db/schema';
import { eq, and } from 'drizzle-orm';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
	if (transporter) {
		return transporter;
	}

	// Check if SMTP is configured
	if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
		console.warn(
			'SMTP not configured. Email sending will be disabled. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD environment variables.'
		);
		// Create a test transporter that won't actually send emails
		transporter = nodemailer.createTransport({
			host: 'localhost',
			port: 1025,
			secure: false,
			auth: {
				user: 'test',
				pass: 'test'
			}
		});
		return transporter;
	}

	transporter = nodemailer.createTransport({
		host: env.SMTP_HOST,
		port: parseInt(env.SMTP_PORT || '587'),
		secure: env.SMTP_PORT === '465', // true for 465, false for other ports
		auth: {
			user: env.SMTP_USER,
			pass: env.SMTP_PASSWORD
		}
	});

	return transporter;
}

export async function sendInvitationEmail(
	email: string,
	invitationToken: string,
	tenantName: string,
	inviterName: string
): Promise<void> {
	const transporter = getTransporter();
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
	const invitationUrl = `${baseUrl}/invite/${invitationToken}`;

	const fromEmail = env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com';

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: email,
		subject: `You've been invited to join ${tenantName}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Invitation to ${tenantName}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">You've been invited!</h1>
					<p>Hello,</p>
					<p><strong>${inviterName}</strong> has invited you to join <strong>${tenantName}</strong> on the CRM platform.</p>
					<p>Click the button below to accept the invitation:</p>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${invitationUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Accept Invitation</a>
					</div>
					<p style="font-size: 14px; color: #666;">Or copy and paste this link into your browser:</p>
					<p style="font-size: 14px; color: #2563eb; word-break: break-all;">${invitationUrl}</p>
					<p style="font-size: 12px; color: #999; margin-top: 30px;">This invitation will expire in 7 days.</p>
					<p style="font-size: 12px; color: #999;">If you didn't expect this invitation, you can safely ignore this email.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			You've been invited!
			
			${inviterName} has invited you to join ${tenantName} on the CRM platform.
			
			Accept the invitation by visiting this link:
			${invitationUrl}
			
			This invitation will expire in 7 days.
			
			If you didn't expect this invitation, you can safely ignore this email.
		`
	};

		try {
			await transporter.sendMail(mailOptions);
			console.log(`Invitation email sent to ${email}`);
		} catch (error) {
			console.error('Failed to send invitation email:', error);
			throw new Error('Failed to send invitation email');
		}
	}

/**
 * Send invoice email to client
 */
export async function sendInvoiceEmail(invoiceId: string, clientEmail: string): Promise<void> {
	const transporter = getTransporter();
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get invoice details
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	// Get client details
	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, invoice.tenantId))
		.limit(1);

	const fromEmail = env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const invoiceUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/invoices/${invoiceId}`;

	// Format amounts
	const formatAmount = (cents: number | null | undefined, currency: string) => {
		if (cents === null || cents === undefined) return 'N/A';
		const amount = (cents / 100).toFixed(2);
		return `${amount} ${currency}`;
	};

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: clientEmail,
		subject: `Invoice ${invoice.invoiceNumber} from ${tenantName}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Invoice ${invoice.invoiceNumber}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">Invoice ${invoice.invoiceNumber}</h1>
					<p>Dear ${client?.name || 'Valued Customer'},</p>
					<p>Please find attached your invoice from <strong>${tenantName}</strong>.</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
						<p><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</p>
						${invoice.issueDate ? `<p><strong>Issue Date:</strong> ${new Date(invoice.issueDate).toLocaleDateString()}</p>` : ''}
						${invoice.dueDate ? `<p><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>` : ''}
						<p><strong>Total Amount:</strong> ${formatAmount(invoice.totalAmount, invoice.currency)}</p>
						${invoice.status === 'paid' ? '<p style="color: green;"><strong>Status:</strong> Paid</p>' : ''}
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${invoiceUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Invoice</a>
					</div>
					${invoice.dueDate && invoice.status !== 'paid' ? `<p style="font-size: 14px; color: #666;">Payment is due by ${new Date(invoice.dueDate).toLocaleDateString()}.</p>` : ''}
					<p style="font-size: 12px; color: #999; margin-top: 30px;">If you have any questions, please don't hesitate to contact us.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Invoice ${invoice.invoiceNumber}

			Dear ${client?.name || 'Valued Customer'},

			Please find your invoice from ${tenantName}.

			Invoice Number: ${invoice.invoiceNumber}
			${invoice.issueDate ? `Issue Date: ${new Date(invoice.issueDate).toLocaleDateString()}\n` : ''}
			${invoice.dueDate ? `Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}\n` : ''}
			Total Amount: ${formatAmount(invoice.totalAmount, invoice.currency)}

			View invoice: ${invoiceUrl}

			${invoice.dueDate && invoice.status !== 'paid' ? `Payment is due by ${new Date(invoice.dueDate).toLocaleDateString()}.\n` : ''}

			If you have any questions, please don't hesitate to contact us.
		`
	};

	try {
		await transporter.sendMail(mailOptions);
		console.log(`Invoice email sent to ${clientEmail} for invoice ${invoice.invoiceNumber}`);
	} catch (error) {
		console.error('Failed to send invoice email:', error);
		throw new Error('Failed to send invoice email');
	}
}

/**
 * Send task assignment email
 */
export async function sendTaskAssignmentEmail(
	taskId: string,
	assigneeEmail: string,
	assigneeName?: string
): Promise<void> {
	const transporter = getTransporter();
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get task details
	const [task] = await db
		.select()
		.from(table.task)
		.where(eq(table.task.id, taskId))
		.limit(1);

	if (!task) {
		throw new Error('Task not found');
	}

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, task.tenantId))
		.limit(1);

	const fromEmail = env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: assigneeEmail,
		subject: `New Task Assigned: ${task.title}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Task Assigned: ${task.title}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">Task Assigned to You</h1>
					<p>Hello ${assigneeName || 'there'},</p>
					<p>You have been assigned a new task:</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
						<h2 style="margin-top: 0; color: #2563eb;">${task.title}</h2>
						${task.description ? `<p style="color: #666;">${task.description}</p>` : ''}
						<p><strong>Priority:</strong> ${task.priority || 'Medium'}</p>
						<p><strong>Status:</strong> ${task.status || 'Todo'}</p>
						${task.dueDate ? `<p><strong>Due Date:</strong> ${new Date(task.dueDate).toLocaleDateString()}</p>` : ''}
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${taskUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Task</a>
					</div>
				</div>
			</body>
			</html>
		`,
		text: `
			Task Assigned to You

			Hello ${assigneeName || 'there'},

			You have been assigned a new task:

			${task.title}
			${task.description ? `\n${task.description}\n` : ''}
			Priority: ${task.priority || 'Medium'}
			Status: ${task.status || 'Todo'}
			${task.dueDate ? `Due Date: ${new Date(task.dueDate).toLocaleDateString()}\n` : ''}

			View task: ${taskUrl}
		`
	};

	try {
		await transporter.sendMail(mailOptions);
		console.log(`Task assignment email sent to ${assigneeEmail} for task ${task.title}`);
	} catch (error) {
		console.error('Failed to send task assignment email:', error);
		throw new Error('Failed to send task assignment email');
	}
}

/**
 * Send task update email to watchers
 */
export async function sendTaskUpdateEmail(
	taskId: string,
	watcherEmail: string,
	watcherName?: string,
	changeType?: string
): Promise<void> {
	const transporter = getTransporter();
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get task details
	const [task] = await db
		.select()
		.from(table.task)
		.where(eq(table.task.id, taskId))
		.limit(1);

	if (!task) {
		throw new Error('Task not found');
	}

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, task.tenantId))
		.limit(1);

	const fromEmail = env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

	const changeDescription =
		changeType === 'status'
			? 'status was updated'
			: changeType === 'assigned'
				? 'assignment was changed'
				: changeType === 'dueDate'
					? 'due date was updated'
					: 'task was updated';

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: watcherEmail,
		subject: `Task Updated: ${task.title}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Task Updated: ${task.title}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">Task Updated</h1>
					<p>Hello ${watcherName || 'there'},</p>
					<p>A task you're watching has been updated:</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
						<h2 style="margin-top: 0; color: #2563eb;">${task.title}</h2>
						<p><strong>What changed:</strong> The task's ${changeDescription}.</p>
						${task.description ? `<p style="color: #666;">${task.description}</p>` : ''}
						<p><strong>Priority:</strong> ${task.priority || 'Medium'}</p>
						<p><strong>Status:</strong> ${task.status || 'Todo'}</p>
						${task.dueDate ? `<p><strong>Due Date:</strong> ${new Date(task.dueDate).toLocaleDateString()}</p>` : ''}
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${taskUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Task</a>
					</div>
				</div>
			</body>
			</html>
		`,
		text: `
			Task Updated

			Hello ${watcherName || 'there'},

			A task you're watching has been updated:

			${task.title}
			What changed: The task's ${changeDescription}.

			${task.description ? `\n${task.description}\n` : ''}
			Priority: ${task.priority || 'Medium'}
			Status: ${task.status || 'Todo'}
			${task.dueDate ? `Due Date: ${new Date(task.dueDate).toLocaleDateString()}\n` : ''}

			View task: ${taskUrl}
		`
	};

	try {
		await transporter.sendMail(mailOptions);
		console.log(`Task update email sent to ${watcherEmail} for task ${task.title}`);
	} catch (error) {
		console.error('Failed to send task update email:', error);
		throw new Error('Failed to send task update email');
	}
}

/**
 * Send invoice paid confirmation email
 */
export async function sendInvoicePaidEmail(invoiceId: string, clientEmail: string): Promise<void> {
	const transporter = getTransporter();
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get invoice details
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	// Get client details
	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, invoice.tenantId))
		.limit(1);

	const fromEmail = env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const invoiceUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/invoices/${invoiceId}`;

	// Format amounts
	const formatAmount = (cents: number | null | undefined, currency: string) => {
		if (cents === null || cents === undefined) return 'N/A';
		const amount = (cents / 100).toFixed(2);
		return `${amount} ${currency}`;
	};

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: clientEmail,
		subject: `Payment Received: Invoice ${invoice.invoiceNumber}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Payment Received: Invoice ${invoice.invoiceNumber}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #10b981; margin-top: 0;">Payment Received</h1>
					<p>Dear ${client?.name || 'Valued Customer'},</p>
					<p>We've received your payment for the following invoice:</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #10b981;">
						<p><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</p>
						<p><strong>Amount Paid:</strong> ${formatAmount(invoice.totalAmount, invoice.currency)}</p>
						${invoice.paidDate ? `<p><strong>Payment Date:</strong> ${new Date(invoice.paidDate).toLocaleDateString()}</p>` : ''}
						${invoice.issueDate ? `<p><strong>Invoice Date:</strong> ${new Date(invoice.issueDate).toLocaleDateString()}</p>` : ''}
					</div>
					<p style="color: #10b981; font-weight: bold;">Thank you for your payment!</p>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${invoiceUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Invoice</a>
					</div>
					<p style="font-size: 12px; color: #999;">If you have any questions, please don't hesitate to contact us.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Payment Received

			Dear ${client?.name || 'Valued Customer'},

			We've received your payment for the following invoice:

			Invoice Number: ${invoice.invoiceNumber}
			Amount Paid: ${formatAmount(invoice.totalAmount, invoice.currency)}
			${invoice.paidDate ? `Payment Date: ${new Date(invoice.paidDate).toLocaleDateString()}\n` : ''}
			${invoice.issueDate ? `Invoice Date: ${new Date(invoice.issueDate).toLocaleDateString()}\n` : ''}

			Thank you for your payment!

			View invoice: ${invoiceUrl}

			If you have any questions, please don't hesitate to contact us.
		`
	};

	try {
		await transporter.sendMail(mailOptions);
		console.log(`Invoice paid email sent to ${clientEmail} for invoice ${invoice.invoiceNumber}`);
	} catch (error) {
		console.error('Failed to send invoice paid email:', error);
		throw new Error('Failed to send invoice paid email');
	}
}

/**
 * Send task reminder email
 */
export async function sendTaskReminderEmail(
	taskId: string,
	assigneeEmail: string,
	assigneeName?: string
): Promise<void> {
	const transporter = getTransporter();
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get task details
	const [task] = await db
		.select()
		.from(table.task)
		.where(eq(table.task.id, taskId))
		.limit(1);

	if (!task || !task.dueDate) {
		throw new Error('Task not found or has no due date');
	}

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, task.tenantId))
		.limit(1);

	const fromEmail = env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

	const dueDate = new Date(task.dueDate);
	const now = new Date();
	const isOverdue = dueDate < now;
	const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: assigneeEmail,
		subject: isOverdue
			? `Overdue Task Reminder: ${task.title}`
			: `Task Reminder: ${task.title} - Due ${daysUntilDue === 0 ? 'Today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Task Reminder: ${task.title}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: ${isOverdue ? '#dc2626' : '#f59e0b'}; margin-top: 0;">${isOverdue ? 'Overdue Task Reminder' : 'Task Reminder'}</h1>
					<p>Hello ${assigneeName || 'there'},</p>
					${isOverdue ? '<p style="color: #dc2626; font-weight: bold;">This task is overdue!</p>' : `<p>This task is due ${daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}.</p>`}
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid ${isOverdue ? '#dc2626' : '#f59e0b'};">
						<h2 style="margin-top: 0; color: #2563eb;">${task.title}</h2>
						${task.description ? `<p style="color: #666;">${task.description}</p>` : ''}
						<p><strong>Priority:</strong> ${task.priority || 'Medium'}</p>
						<p><strong>Status:</strong> ${task.status || 'Todo'}</p>
						<p><strong>Due Date:</strong> <span style="color: ${isOverdue ? '#dc2626' : '#333'};">${dueDate.toLocaleDateString()}</span></p>
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${taskUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Task</a>
					</div>
				</div>
			</body>
			</html>
		`,
		text: `
			${isOverdue ? 'Overdue Task Reminder' : 'Task Reminder'}

			Hello ${assigneeName || 'there'},

			${isOverdue ? 'This task is overdue!' : `This task is due ${daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}.`}

			${task.title}
			${task.description ? `\n${task.description}\n` : ''}
			Priority: ${task.priority || 'Medium'}
			Status: ${task.status || 'Todo'}
			Due Date: ${dueDate.toLocaleDateString()}

			View task: ${taskUrl}
		`
	};

	try {
		await transporter.sendMail(mailOptions);
		console.log(`Task reminder email sent to ${assigneeEmail} for task ${task.title}`);
	} catch (error) {
		console.error('Failed to send task reminder email:', error);
		throw new Error('Failed to send task reminder email');
	}
}
